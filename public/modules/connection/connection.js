window.ConnectionModule = {
    init: async function (containerId, hostInfo) {
        if (!containerId) return;
        const TERMINAL_FONT_FAMILY = '"JetBrains Mono", monospace';
        const DEFAULT_TAB_FONT_SCALE = 1.1;
        const CONNECT_MESSAGE_DELAY_MS = 250;
        const IDLE_RECONNECT_THRESHOLD_MS = 30000;
        const QUICK_RECONNECT_DELAY_MS = 1500;
        const RETRY_RECONNECT_DELAY_MS = 5000;
        const CONNECT_RETRY_DELAYS_MS = [1000, 3000, 10000, 20000];
        let isUserDisconnected = false;
        let reconnecting = false;
        const container = document.getElementById(containerId);
        if (!container) return;
        const tabId = containerId.replace('terminal-', '');
        const isAndroid = Boolean(window.TermixAndroid);
        const clientRequestId = isAndroid ? `connect-${tabId}-${Date.now()}` : null;
        let currentSessionId = null;
        let mobileToolbar = null;
        let pendingCleanup = () => {};
        // Register cancellation before the first await; closing a connecting tab must
        // not leave an orphan socket (including while a host-trust prompt is open).
        if (isAndroid && window.TabManager) {
            const pendingTab = window.TabManager.tabs.find(tab => tab.id === tabId);
            if (pendingTab) pendingTab.sessionObj = {
                dispose() {
                    isUserDisconnected = true;
                    window.electronAPI.send('term-close', { requestId: clientRequestId, ...(currentSessionId ? { sessionId: currentSessionId } : {}) });
                    pendingCleanup();
                }
            };
        }
        let resizeObserver = null;
        const aiContextSourceId = `terminal:${tabId}`;
        let lastSelectionForAi = null;
        let lastActivityAt = Date.now();
        let reconnectTimerId = null;
        let connectRetryTimerId = null;
        let restartHandler = null;
        let initialResizeTimerId = null;
        let outputListener = null;
        let disconnectListener = null;
        let sshReadyListener = null;
        let osc52Listener = null;

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

        const clearConnectRetryTimer = () => {
            if (connectRetryTimerId) {
                clearTimeout(connectRetryTimerId);
                connectRetryTimerId = null;
            }
        };

        const clearRestartHandler = () => {
            if (!restartHandler) return;
            try {
                restartHandler.dispose();
            } catch (_) {}
            restartHandler = null;
        };

        const disposeListener = (subscription) => {
            if (!subscription || typeof subscription.dispose !== 'function') return;
            try {
                subscription.dispose();
            } catch (_) {}
        };

        const clearInitialResizeTimer = () => {
            if (!initialResizeTimerId) return;
            clearTimeout(initialResizeTimerId);
            initialResizeTimerId = null;
        };

        const clearEventListeners = () => {
            disposeListener(outputListener);
            disposeListener(disconnectListener);
            disposeListener(sshReadyListener);
            outputListener = null;
            disconnectListener = null;
            sshReadyListener = null;
        };

        const clearOsc52Listener = () => {
            disposeListener(osc52Listener);
            osc52Listener = null;
        };

        const decodeOsc52Payload = (value) => {
            if (typeof value !== 'string') return null;
            const normalized = value.replace(/\s+/g, '');
            if (!normalized) return '';
            if (normalized.length > 1024 * 1024) return null;

            try {
                const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
                const binary = window.atob(padded);
                const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
                return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
            } catch (_) {
                return null;
            }
        };

        // Match container color with the value from settings.
        let TerminalSettings;
        try {
            TerminalSettings = await window.electronAPI.connection.getSettings();
        } catch (error) {
            if (isAndroid) {
                if (!isUserDisconnected) window.notifyUser(`Terminal settings failed: ${error.message}`, 'error');
                return null;
            }
            throw error;
        }
        if (isUserDisconnected || !document.getElementById(containerId)) return null;
        if (TerminalSettings.theme && TerminalSettings.theme.background) {
            container.style.backgroundColor = TerminalSettings.theme.background;
        }

        const defaultMobileFontSize = 11;
        const baseFontSize = isAndroid
            ? (Number(TerminalSettings.mobileFontSize) || defaultMobileFontSize)
            : (Number(TerminalSettings.fontSize) || 14);
        const defaultTabFontSize = isAndroid
            ? baseFontSize
            : Math.max(6, Math.round((baseFontSize * DEFAULT_TAB_FONT_SCALE) * 10) / 10);
        const hostFontSize = isAndroid
            ? Number(hostInfo && hostInfo.mobileTerminalFontSize)
            : Number(hostInfo && hostInfo.terminalFontSize);
        const initialFontSize = Number.isFinite(hostFontSize) && hostFontSize >= 6
            ? hostFontSize
            : defaultTabFontSize;

        // Ensure JetBrains Mono is fully loaded before creating the terminal so that
        // xterm.js measures character dimensions with the correct font and avoids
        // rendering inconsistencies caused by a fallback font being used at init time.
        // document.fonts.ready is awaited first so that all @font-face declarations
        // from the @fontsource stylesheets are registered before we request the font.
        // Without this, document.fonts.load() may return an empty result on the very
        // first connection (before the CSS has been fully processed) and the terminal
        // falls back to a different font until the next reconnect.
        try {
            if (window.TermixFontLoader && typeof window.TermixFontLoader.ensureLoaded === 'function') {
                await window.TermixFontLoader.ensureLoaded(initialFontSize);
            } else {
                await document.fonts.ready;
                await document.fonts.load(`${initialFontSize}px "JetBrains Mono"`);
                await document.fonts.load(`500 ${initialFontSize}px "JetBrains Mono"`);
            }
        } catch (_) {
            // Non-fatal: proceed even if the font-load promise rejects
        }

        // Wait one animation frame so the browser applies the loaded font metrics
        // before xterm.js measures character cell dimensions.
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (isUserDisconnected || !document.getElementById(containerId)) return null;

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
        pendingCleanup = () => {
            clearOsc52Listener();
            if (mobileToolbar) mobileToolbar.dispose();
            if (resizeObserver) resizeObserver.disconnect();
            try { term.dispose(); } catch (_) {}
        };
        if (isAndroid && term.textarea) {
            term.textarea.setAttribute('autocapitalize', 'off');
            term.textarea.setAttribute('autocorrect', 'off');
            term.textarea.setAttribute('spellcheck', 'false');
        }
        try {
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            fitAddon.fit();
            term.refresh(0, Math.max(0, term.rows - 1));
        } catch (_) {}

        try {
            if (term.parser && typeof term.parser.registerOscHandler === 'function') {
                osc52Listener = term.parser.registerOscHandler(52, (data) => {
                    if (typeof data !== 'string') return false;
                    const separatorIndex = data.indexOf(';');
                    if (separatorIndex < 0) return false;

                    const payload = data.slice(separatorIndex + 1);
                    if (payload === '?') return true;

                    const decoded = decodeOsc52Payload(payload);
                    if (decoded == null) return true;

                    if (window.clipboard && typeof window.clipboard.writeText === 'function') {
                        Promise.resolve(window.clipboard.writeText(decoded)).catch(error => console.warn('Clipboard write failed:', error));
                    }
                    return true;
                });
            }
        } catch (e) {
            console.warn('OSC 52 handler could not be registered', e);
        }

        // In a split layout several terminals are visible at once, but only the
        // active tab of the focused pane may consume keyboard input.
        function isActiveTerminalTab() {
            if (!window.TabManager) return true;
            if (typeof window.TabManager.isTabFocused === 'function') {
                return window.TabManager.isTabFocused(tabId);
            }
            if (!window.TabManager.activeTabId) return true;
            return window.TabManager.activeTabId === tabId;
        }

        function focusTerminal(forceScroll = false) {
            if (!document.getElementById(containerId)) return;
            try {
                term.focus();
            } catch (_) {}

            const helperTextarea = container.querySelector('.xterm-helper-textarea');
            if (helperTextarea && document.activeElement !== helperTextarea) {
                try {
                    helperTextarea.focus({ preventScroll: true });
                } catch (_) {
                    try { helperTextarea.focus(); } catch (_) {}
                }
            }

            if (forceScroll) {
                try { term.scrollToBottom(); } catch (_) {}
            } else {
                try {
                    const buffer = term.buffer ? term.buffer.active : null;
                    if (buffer && buffer.viewportY >= buffer.baseY && (!term.hasSelection || !term.hasSelection())) {
                        term.scrollToBottom();
                    }
                } catch (_) {}
            }
        }

        function scheduleTerminalFocus() {
            setTimeout(() => {
                if (isUserDisconnected || !isActiveTerminalTab()) return;
                requestAnimationFrame(() => {
                    if (isUserDisconnected || !isActiveTerminalTab()) return;
                    focusTerminal();
                });
            }, 0);
        }

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
            focusTerminal();
        });

        scheduleTerminalFocus();

        // Loading the WebGL addon improves performance, eliminates stutter, and provides
        // hardware-accelerated, crisp monospace glyph rendering on both desktop and Android WebView.
        if (window.WebglAddon && typeof window.WebglAddon.WebglAddon === 'function') {
            try {
                const webglAddon = new window.WebglAddon.WebglAddon();
                webglAddon.onContextLoss(e => {
                    webglAddon.dispose();
                    // Force xterm to re-render via its DOM fallback renderer so that
                    // the screen does not go blank after a GPU context loss.
                    try { term.refresh(0, term.rows - 1); } catch (_) {}
                });
                term.loadAddon(webglAddon);
            } catch (e) {
                console.warn("WebGL addon could not be loaded", e);
            }
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
        let didRenderConnectMsg = false;
        const msgTimer = setTimeout(() => {
            didRenderConnectMsg = true;
            term.writeln(connectMsg);
        }, CONNECT_MESSAGE_DELAY_MS);

        const getConnectRetryDelay = (attemptIndex) => {
            if (attemptIndex < 0) return CONNECT_RETRY_DELAYS_MS[0];
            if (attemptIndex >= CONNECT_RETRY_DELAYS_MS.length) return CONNECT_RETRY_DELAYS_MS[CONNECT_RETRY_DELAYS_MS.length - 1];
            return CONNECT_RETRY_DELAYS_MS[attemptIndex];
        };

        let sessionResult;
        let connectRetryAttempt = 0;
        const sendTerminalInput = data => {
            if (isUserDisconnected || !currentSessionId) return;
            markActivity();
            window.electronAPI.send('term-input', { sessionId: currentSessionId, data });
        };
        if (window.TermixMobile) mobileToolbar = window.TermixMobile.attachTerminal(container, term, sendTerminalInput, sendResize);
        pendingCleanup = () => {
            clearTimeout(msgTimer);
            clearOsc52Listener();
            if (mobileToolbar) mobileToolbar.dispose();
            if (resizeObserver) resizeObserver.disconnect();
            try { term.dispose(); } catch (_) {}
        };

        // Fit the terminal to the container before connecting so that the backend
        // opens the shell with the actual initial dimensions rather than 80x24.
        try { fitAddon.fit(); } catch (_) {}
        hostInfo.initialCols = term.cols || 80;
        hostInfo.initialRows = term.rows || 24;

        while (true) {
            if (isUserDisconnected || !document.getElementById(containerId)) { pendingCleanup(); return null; }
            try {
                sessionResult = isAndroid
                    ? await window.electronAPI.connection.connect(hostInfo, { clientRequestId })
                    : await window.electronAPI.connection.connect(hostInfo);
            } catch (err) {
                sessionResult = { status: 'error', message: err && err.message ? err.message : 'Connection failed.' };
            }

            clearTimeout(msgTimer);
            if (isUserDisconnected || !document.getElementById(containerId)) {
                if (sessionResult && sessionResult.sessionId) window.electronAPI.send('term-close', { sessionId: sessionResult.sessionId });
                pendingCleanup();
                return null;
            }

            if (sessionResult && sessionResult.status !== 'error' && (!isAndroid || sessionResult.sessionId)) {
                break;
            }

            const errorMessage = sessionResult && sessionResult.message ? sessionResult.message : 'Unknown connection error.';
            term.writeln(`\x1b[31mConnection Error: ${errorMessage}\x1b[0m`);
            if (isAndroid) {
                // Never retry rejected credentials or host trust indefinitely. The user
                // can edit the host and explicitly reconnect from the dashboard.
                term.writeln('Check the host details, then close this tab and reconnect.');
                return { term, fitAddon, focus: focusTerminal, dispose: () => { isUserDisconnected = true; pendingCleanup(); } };
            }

            const retryDelay = getConnectRetryDelay(connectRetryAttempt);
            const retryDelaySeconds = Math.round(retryDelay / 1000);
            term.writeln(`\x1b[33mRetrying in ${retryDelaySeconds} second${retryDelaySeconds === 1 ? '' : 's'}...\x1b[0m`);

            await new Promise((resolve) => {
                connectRetryTimerId = setTimeout(() => {
                    connectRetryTimerId = null;
                    resolve();
                }, retryDelay);
            });

            if (!document.getElementById(containerId)) {
                clearReconnectTimer();
                clearConnectRetryTimer();
                clearTimeout(msgTimer);
                try { term.dispose(); } catch (_) {}
                if (resizeObserver) resizeObserver.disconnect();
                return null;
            }

            connectRetryAttempt += 1;
        }

        currentSessionId = sessionResult.sessionId;

        if (didRenderConnectMsg) {
            term.clear();
        }
        markActivity();

        // Backend -> Frontend (Output)
        const outputHandler = (event, msg) => {
            if (msg && msg.sessionId === currentSessionId) {
                markActivity();
                term.write(msg.data, () => {
                    if (isAndroid) {
                        try { term.scrollToBottom(); } catch (_) {}
                    }
                });
            }
        };

        const triggerReload = async () => {
            if (reconnecting || isUserDisconnected) return;
            reconnecting = true;
            try {
                clearReconnectTimer();
                clearInitialResizeTimer();
                clearRestartHandler();
                clearEventListeners();
                clearOsc52Listener();
                if (mobileToolbar) mobileToolbar.dispose();
                emitAiSelectionContext('');
                try { window.electronAPI.send('term-close', { sessionId: currentSessionId }); } catch (_) {}
                window.removeEventListener('keydown', handleTerminalZoomKeydown);
                window.removeEventListener('keydown', handleTerminalAutoFocusKeydown, true);
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
                if (isAndroid) {
                    currentSessionId = null;
                    if (window.TabManager && typeof window.TabManager.closeTab === 'function') {
                        window.TabManager.closeTab(tabId);
                        return;
                    }
                    term.writeln('');
                    term.writeln(`Session ended.${disconnectMessage ? ' ' + disconnectMessage : ''}`);
                    term.writeln('Close this tab and select the host to reconnect.');
                    return;
                }
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
                    focusTerminal();
                    
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

        // Frontend -> Backend (Input)
        term.onData(data => {
            sendTerminalInput(mobileToolbar ? mobileToolbar.filterInput(data) : data);
        });

        const isEditableElement = (element) => {
            if (!element) return false;
            const tagName = element.tagName ? element.tagName.toLowerCase() : '';
            return tagName === 'input' || tagName === 'textarea' || element.isContentEditable;
        };

        const getKeyboardInputData = (event) => {
            if (event.ctrlKey || event.metaKey || event.altKey) return null;
            if (event.key === 'Enter') return '\r';
            if (event.key === 'Backspace') return '\u007f';
            if (event.key === 'Tab') return '\t';
            if (event.key === 'Escape') return '\u001b';
            if (event.key === 'ArrowUp') return '\u001b[A';
            if (event.key === 'ArrowDown') return '\u001b[B';
            if (event.key === 'ArrowRight') return '\u001b[C';
            if (event.key === 'ArrowLeft') return '\u001b[D';
            if (event.key.length === 1) return event.key;
            return null;
        };

        const handleTerminalAutoFocusKeydown = (event) => {
            if (isUserDisconnected || !isActiveTerminalTab()) return;
            if (isEditableElement(document.activeElement)) return;
            if (container.contains(document.activeElement)) return;

            const data = getKeyboardInputData(event);
            if (!data) return;

            event.preventDefault();
            focusTerminal();

            if (restartHandler && data === '\r') {
                clearRestartHandler();
                term.writeln('Restarting...');
                triggerReload().catch(e => {
                    if (!isUserDisconnected) term.writeln(`\x1b[31mRestart failed: ${e && e.message ? e.message : e}\x1b[0m`);
                });
                return;
            }

            markActivity();
            window.electronAPI.send('term-input', { sessionId: currentSessionId, data });
        };

        let lastCols = 0;
        let lastRows = 0;

        function sendResize() {
            // Skip resize if container is hidden or has zero dimensions.
            if (isUserDisconnected || !currentSessionId || !container.clientWidth || !container.clientHeight) return;

            // Calculate dimensions via fit addon.
            fitAddon.fit();

            // Deduplicate to avoid flooding the backend and SSH channel with redundant resizes.
            if (term.cols === lastCols && term.rows === lastRows) return;
            lastCols = term.cols;
            lastRows = term.rows;

            try {
                const buffer = term.buffer ? term.buffer.active : null;
                if (buffer && buffer.viewportY >= buffer.baseY) {
                    term.scrollToBottom();
                }
            } catch (_) {}

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
        const readyHandler = (event, msg) => {
            if (msg && msg.sessionId === currentSessionId) {
                clearReconnectTimer();
                markActivity();
                sendResize();
                scheduleTerminalFocus();
            }
        };

        sshReadyListener = window.electronAPI.on('ssh-ready', readyHandler);
        outputListener = window.electronAPI.on('term-data', outputHandler);
        disconnectListener = window.electronAPI.on('term-disconnected', disconnectHandler);

        sendResize();
        // window.addEventListener('resize', sendResize); // ResizeObserver already handles this

        // Run once initially (small delay to avoid timing issues).
        initialResizeTimerId = setTimeout(() => {
            initialResizeTimerId = null;
            sendResize();
            scheduleTerminalFocus();
        }, 100);

        const persistHostFontSize = async (fontSize) => {
            if (!hostInfo || hostInfo.id == null) return;
            const parsed = Number(fontSize);
            if (!Number.isFinite(parsed) || parsed < 6) return;

            if (isAndroid) {
                hostInfo.mobileTerminalFontSize = parsed;
                return;
            }

            if (!window.electronAPI || !window.electronAPI.hosts || !window.electronAPI.hosts.updateTerminalFontSize) return;

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
        if (!isAndroid) window.addEventListener('keydown', handleTerminalAutoFocusKeydown, true);

        term.onSelectionChange(() => {
            const selection = term.getSelection();
            if (!isAndroid && TerminalSettings.rightClickCopyPaste && selection) {
                Promise.resolve(clipboard.writeText(selection)).catch(error => console.warn('Clipboard write failed:', error));
            }
            emitAiSelectionContext(selection);
        });

        if (!isAndroid && TerminalSettings.rightClickCopyPaste) { // Paste on right-click (desktop only)
            container.addEventListener('contextmenu', async (e) => {
                e.preventDefault();
                try {
                    const text = await clipboard.readText();
                    if (text && !isUserDisconnected) term.paste(text);
                } catch (error) { window.notifyUser(`Clipboard read failed: ${error.message}`, 'error'); }
            });
        }

        container.term = term;
        container.fitAddon = fitAddon;

        return {
            sessionId: currentSessionId,
            term: term,
            fitAddon: fitAddon,
            focus: focusTerminal,
            dispose: () => {
                isUserDisconnected = true;
                clearTimeout(msgTimer);
                clearReconnectTimer();
                clearConnectRetryTimer();
                clearInitialResizeTimer();
                clearRestartHandler();
                clearEventListeners();
                clearOsc52Listener();
                if (mobileToolbar) mobileToolbar.dispose();
                emitAiSelectionContext('');
                // Stop observer
                if (resizeObserver) resizeObserver.disconnect();
                window.removeEventListener('keydown', handleTerminalZoomKeydown);
                window.removeEventListener('keydown', handleTerminalAutoFocusKeydown, true);
                // Dispose terminal
                try { term.dispose(); } catch (_) {}
                // Send close request to backend (optional)
                try {
                    window.electronAPI.send('term-close', { ...(currentSessionId ? { sessionId: currentSessionId } : {}), ...(clientRequestId ? { requestId: clientRequestId } : {}) });
                } catch (_) {}
            }
        };
    }
};
