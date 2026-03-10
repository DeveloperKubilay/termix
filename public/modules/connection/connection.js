window.ConnectionModule = {
    init: async function (containerId, hostInfo) {
        if (!containerId) return;
        const TERMINAL_FONT_FAMILY = '"JetBrains Mono", "Fira Code", "Cascadia Mono", "Cascadia Code", Consolas, "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Courier New", monospace';
        const DEFAULT_TAB_FONT_SCALE = 1.1;
        const IDLE_RECONNECT_THRESHOLD_MS = 30000;
        const QUICK_RECONNECT_DELAY_MS = 1500;
        const RETRY_RECONNECT_DELAY_MS = 5000;
        let isUserDisconnected = false;
        let reconnecting = false;
        const container = document.getElementById(containerId);
        if (!container) return;
        const tabId = containerId.replace('terminal-', '');
        let resizeObserver = null;
        const aiContextSourceId = `terminal:${tabId}`;
        let lastSelectionForAi = null;
        let lastActivityAt = Date.now();
        let reconnectTimerId = null;
        let restartHandler = null;

        const toText = (value) => String(value == null ? '' : value).trim();

        const getAiContextSourceLabel = () => {
            const protocol = toText(hostInfo && hostInfo.protocol).toUpperCase();
            if (protocol === 'LOCAL') return 'Local Terminal';
            if (protocol === 'SERIAL') {
                return toText(hostInfo && (hostInfo.path || hostInfo.name)) || 'Serial Terminal';
            }

            const name = toText(hostInfo && hostInfo.name);
            if (name) return name;

            const username = toText(hostInfo && hostInfo.username);
            const address = toText(hostInfo && (hostInfo.hostname || hostInfo.address));
            if (username && address) return `${username}@${address}`;
            return address || 'SSH Terminal';
        };

        const emitAiSelectionContext = (selectionText) => {
            const normalizedSelection = toText(selectionText);
            if (normalizedSelection === lastSelectionForAi) return;
            lastSelectionForAi = normalizedSelection;

            try {
                window.dispatchEvent(new CustomEvent('termix:ai-context-selection', {
                    detail: {
                        sourceId: aiContextSourceId,
                        sourceKind: 'terminal-selection',
                        sourceLabel: getAiContextSourceLabel(),
                        text: normalizedSelection
                    }
                }));
            } catch (_) {}
        };

        const markActivity = () => {
            lastActivityAt = Date.now();
        };

        const clearReconnectTimer = () => {
            if (reconnectTimerId) {
                clearTimeout(reconnectTimerId);
                reconnectTimerId = null;
            }
        };

        const clearRestartHandler = () => {
            if (!restartHandler) return;
            try {
                restartHandler.dispose();
            } catch (_) {}
            restartHandler = null;
        };

        // Match container color with the value from settings.
        const TerminalSettings = await window.electronAPI.connection.getSettings();
        if (TerminalSettings.theme && TerminalSettings.theme.background) {
            container.style.backgroundColor = TerminalSettings.theme.background;
        }

        const baseFontSize = Number(TerminalSettings.fontSize) || 14;
        const defaultTabFontSize = Math.max(6, Math.round((baseFontSize * DEFAULT_TAB_FONT_SCALE) * 10) / 10);
        const hostFontSize = Number(hostInfo && hostInfo.terminalFontSize);
        const initialFontSize = Number.isFinite(hostFontSize) && hostFontSize >= 6
            ? hostFontSize
            : defaultTabFontSize;

        const term = new window.Terminal({
            ...TerminalSettings,
            allowProposedApi: true,
            allowTransparency: true,
            fontFamily: TERMINAL_FONT_FAMILY,
            fontSize: initialFontSize,
            fontWeight: 500
        });

        const fitAddon = new window.FitAddon.FitAddon();
        term.loadAddon(fitAddon);

        term.open(container);

        try {
            if (window.Unicode11Addon && window.Unicode11Addon.Unicode11Addon) {
                const unicode11Addon = new window.Unicode11Addon.Unicode11Addon();
                term.loadAddon(unicode11Addon);
                term.unicode.activeVersion = '11';
            }
        } catch (e) {
            console.warn('Unicode11 addon could not be loaded', e);
        }

        container.addEventListener('mousedown', () => {
            try { term.focus(); } catch (_) {}
        });

        // Loading the WebGL addon after terminal init improves performance and reduces stutter.
        try {
            const webglAddon = new window.WebglAddon.WebglAddon();
            webglAddon.onContextLoss(e => {
                webglAddon.dispose();
            });
            term.loadAddon(webglAddon);
        } catch (e) {
            console.warn("WebGL addon could not be loaded", e);
        }

        // --- SERIAL BAUD RATE PROMPT ---
        if (hostInfo.protocol === 'SERIAL') {
            term.write('Baud Rate (default 9600): ');

            const baudRateInput = await new Promise(resolve => {
                let buffer = '';
                const disposable = term.onData(e => {
                    const charCode = e.charCodeAt(0);

                    if (e === '\r') { // Enter
                        term.writeln('');
                        disposable.dispose();
                        resolve(buffer);
                    } else if (e === '\u007f') { // Backspace
                        if (buffer.length > 0) {
                            buffer = buffer.slice(0, -1);
                            term.write('\b \b');
                        }
                    } else if (charCode >= 32 && charCode <= 126) { // Printable
                        buffer += e;
                        term.write(e);
                    }
                });
            });

            if (baudRateInput.trim()) {
                const parsed = parseInt(baudRateInput.trim());
                if (!isNaN(parsed)) {
                    hostInfo.baudRate = parsed;
                }
            }
            if (!hostInfo.baudRate) hostInfo.baudRate = 9600;
            term.writeln(`\x1b[32mSelected Baud Rate: ${hostInfo.baudRate}\x1b[0m`);
            term.writeln('');
        }
        // -------------------------------

        let connectMsg = "";
        if (hostInfo.protocol === 'SERIAL') {
            connectMsg = `Connecting to ${hostInfo.path} at ${hostInfo.baudRate} baud...`;
        } else if (hostInfo.protocol === 'LOCAL') {
            connectMsg = `Starting Local Terminal...`;
        } else {
            connectMsg = `Connecting to ${hostInfo.username}@${hostInfo.hostname || hostInfo.address || hostInfo.name}...`;
        }
        term.write('');
        const msgTimer = setTimeout(() => {
            term.writeln(connectMsg);
        }, 3000);

        let sessionResult;
        try {
            sessionResult = await window.electronAPI.connection.connect(hostInfo);
        } catch (err) {
            sessionResult = { status: 'error', message: err.message };
        }
        clearTimeout(msgTimer);

        if (sessionResult.status === 'error') {
            term.writeln(`\x1b[31mConnection Error: ${sessionResult.message}\x1b[0m`);
            return {
                dispose: () => {
                    term.dispose();
                    if (resizeObserver) resizeObserver.disconnect();
                }
            };
        }

        const currentSessionId = sessionResult.sessionId;

        // Backend -> Frontend (Output)
        const outputHandler = (event, msg) => {
            if (msg && msg.sessionId === currentSessionId) {
                markActivity();
                term.write(msg.data);
            }
        };
        window.electronAPI.on('term-data', outputHandler);

        const triggerReload = async () => {
            if (reconnecting || isUserDisconnected) return;
            reconnecting = true;
            try {
                clearReconnectTimer();
                clearRestartHandler();
                emitAiSelectionContext('');
                try { window.electronAPI.send('term-close', { sessionId: currentSessionId }); } catch (_) {}
                window.removeEventListener('keydown', handleTerminalZoomKeydown);
                if (resizeObserver) resizeObserver.disconnect();
                try { term.dispose(); } catch (_) {}
                try { container.innerHTML = ''; } catch (_) {}

                if (window.ConnectionModule && !isUserDisconnected) {
                    const newSession = await window.ConnectionModule.init(containerId, hostInfo);
                    if (!newSession) return;
                    if (window.TabManager && window.TabManager.tabs) {
                        const tab = window.TabManager.tabs.find(t => t.id === tabId);
                        if (tab) tab.sessionObj = newSession;
                    }
                }
            } finally {
                reconnecting = false;
            }
        };

        // Backend -> Frontend (Disconnected)
        const disconnectHandler = (event, msg) => {
            if (msg && msg.sessionId === currentSessionId) {
                if (isUserDisconnected) return;

                clearReconnectTimer();
                clearRestartHandler();

                const disconnectMessage = toText(msg.message);
                const idleForMs = Date.now() - lastActivityAt;
                const lowerDisconnectMessage = disconnectMessage.toLowerCase();
                const shouldQuickReconnect = msg.exitCode === 0 && (
                    idleForMs >= IDLE_RECONNECT_THRESHOLD_MS
                    || lowerDisconnectMessage.includes('idle')
                    || lowerDisconnectMessage.includes('timeout')
                );

                if (shouldQuickReconnect) {
                    term.writeln('');
                    term.writeln('\x1b[33mSession closed while idle. Reconnecting...\x1b[0m');
                    reconnectTimerId = setTimeout(() => {
                        reconnectTimerId = null;
                        if (isUserDisconnected) return;
                        triggerReload().catch(e => {
                            if (!isUserDisconnected) term.writeln(`\x1b[31mReconnect failed: ${e && e.message ? e.message : e}\x1b[0m`);
                        });
                    }, QUICK_RECONNECT_DELAY_MS);
                } else if (msg.exitCode === 0) {
                    term.writeln('');
                    term.writeln('\x1b[33mSession ended.\x1b[0m');
                    term.writeln('Press Enter to restart...');
                    try { term.focus(); } catch (_) {}
                    
                    restartHandler = term.onData(data => {
                        if (isUserDisconnected) {
                            clearRestartHandler();
                            return;
                        }
                        if (typeof data === 'string' && (data.includes('\r') || data.includes('\n'))) {
                            clearRestartHandler();
                            term.writeln('Restarting...');
                            triggerReload().catch(e => {
                                if (!isUserDisconnected) term.writeln(`\x1b[31mRestart failed: ${e && e.message ? e.message : e}\x1b[0m`);
                            });
                        }
                    });
                } else {
                    term.clear();
                    const messageSuffix = disconnectMessage ? ` ${disconnectMessage}` : '';
                    term.writeln(`\x1b[31mConnection lost (Code: ${msg.exitCode ?? 'unknown'}). Retrying in 5 seconds...${messageSuffix}\x1b[0m`);
                    reconnectTimerId = setTimeout(() => {
                        reconnectTimerId = null;
                        if (isUserDisconnected) return;
                        triggerReload().catch(e => {
                            if (!isUserDisconnected) term.writeln(`\x1b[31mReconnect failed: ${e && e.message ? e.message : e}\x1b[0m`);
                        });
                    }, RETRY_RECONNECT_DELAY_MS);
                }
            }
        };
        window.electronAPI.on('term-disconnected', disconnectHandler);

        // Frontend -> Backend (Input)
        term.onData(data => {
            if (isUserDisconnected) return;
            markActivity();
            window.electronAPI.send('term-input', { sessionId: currentSessionId, data });
        });

        function sendResize() {
            // Skip resize if container is hidden or has zero dimensions.
            if (!container.clientWidth || !container.clientHeight) return;

            // Calculate dimensions via fit addon.
            fitAddon.fit();

            // Notify backend about the new dimensions.
            // Guard for window.electronAPI.send.
            if (window.electronAPI && window.electronAPI.send) {
                window.electronAPI.send('term-resize', {
                    sessionId: currentSessionId,
                    cols: term.cols,
                    rows: term.rows
                });
            }
        }

        // Watch container size changes with ResizeObserver (including sidebar toggle).
        resizeObserver = new ResizeObserver(() => {
            // Resize in requestAnimationFrame to avoid UI thread pressure.
            requestAnimationFrame(() => sendResize());
        });

        resizeObserver.observe(container);

        // Trigger on first load and when SSH becomes ready.
        window.electronAPI.on('ssh-ready', (event, msg) => {
            if (msg && msg.sessionId === currentSessionId) {
                clearReconnectTimer();
                markActivity();
                term.clear(); // Clear connecting messages
                sendResize();
            }
        });
        // window.addEventListener('resize', sendResize); // ResizeObserver already handles this

        // Run once initially (small delay to avoid timing issues).
        setTimeout(sendResize, 100);


        const isActiveTerminalTab = () => {
            if (!window.TabManager || !window.TabManager.activeTabId) return true;
            return window.TabManager.activeTabId === tabId;
        };

        const persistHostFontSize = async (fontSize) => {
            if (!hostInfo || hostInfo.id == null) return;
            if (!window.electronAPI || !window.electronAPI.hosts || !window.electronAPI.hosts.updateTerminalFontSize) return;

            const parsed = Number(fontSize);
            if (!Number.isFinite(parsed) || parsed < 6) return;

            try {
                await window.electronAPI.hosts.updateTerminalFontSize(hostInfo.id, parsed);
                hostInfo.terminalFontSize = parsed;
            } catch (err) {
                console.warn('Failed to persist host terminal font size:', err);
            }
        };

        const handleTerminalZoomKeydown = (e) => {
            if (isUserDisconnected || !e.ctrlKey || !isActiveTerminalTab()) return;

            const isZoomIn = e.key === '=' || e.key === '+' || e.code === 'NumpadAdd';
            const isZoomOut = e.key === '-' || e.code === 'NumpadSubtract';
            if (!isZoomIn && !isZoomOut) return;

            const currentFontSize = Number(term.options.fontSize) || 14;
            const nextFontSize = isZoomIn ? currentFontSize + 1 : currentFontSize - 1;
            if (nextFontSize < 6) return; // Minimum 6px

            e.preventDefault();
            term.options.fontSize = nextFontSize;
            sendResize();
            persistHostFontSize(nextFontSize);
        };

        window.addEventListener('keydown', handleTerminalZoomKeydown);

        term.onSelectionChange(() => {
            const selection = term.getSelection();
            if (TerminalSettings.rightClickCopyPaste && selection) {
                clipboard.writeText(selection);
            }
            emitAiSelectionContext(selection);
        });

        if (TerminalSettings.rightClickCopyPaste) { // Paste on right-click
            container.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const text = clipboard.readText();
                if (text) {
                    term.paste(text);
                }
            });
        }

        container.term = term;
        container.fitAddon = fitAddon;

        return {
            sessionId: currentSessionId,
            term: term,
            fitAddon: fitAddon,
            dispose: () => {
                isUserDisconnected = true;
                clearTimeout(msgTimer);
                clearReconnectTimer();
                clearRestartHandler();
                emitAiSelectionContext('');
                // Stop observer
                if (resizeObserver) resizeObserver.disconnect();
                window.removeEventListener('keydown', handleTerminalZoomKeydown);
                // Dispose terminal
                try { term.dispose(); } catch (_) {}
                // Send close request to backend (optional)
                window.electronAPI.send('term-close', { sessionId: currentSessionId });
            }
        };
    }
};
