window.ConnectionModule = {
    init: async function (containerId, hostInfo) {
        if (!containerId) return;
        const container = document.getElementById(containerId);
        if (!container) return;

        // Container rengini settings'ten gelen renkle eşle
        const TerminalSettings = await window.electronAPI.connection.getSettings();
        if (TerminalSettings.theme && TerminalSettings.theme.background) {
            container.style.backgroundColor = TerminalSettings.theme.background;
        }

        const term = new window.Terminal({
            ...TerminalSettings,
            allowTransparency: true,
            fontFamily: '"JetBrains Mono", Consolas, monospace', // Force prefer JetBrains
            fontSize: TerminalSettings.fontSize || 14,
            fontWeight: 500
        });

        const fitAddon = new window.FitAddon.FitAddon();
        term.loadAddon(fitAddon);

        term.open(container);

        // WebGL Addon'u terminal açıldıktan sonra yüklemek performansı artırır ve takılmaları önler
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

        const sessionResult = await window.electronAPI.connection.connect(hostInfo);
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
        window.electronAPI.on('term-data', (event, msg) => {
            if (msg && msg.sessionId === currentSessionId) {
                term.write(msg.data);
            }
        });

        // Backend -> Frontend (Disconnected)
        window.electronAPI.on('term-disconnected', (event, msg) => {
            if (msg && msg.sessionId === currentSessionId) {
                term.clear();
                term.writeln('\x1b[33mConnection lost. Retrying in 3 seconds...\x1b[0m');
                
                setTimeout(async () => {
                   term.writeln('Reconnecting...');
                   // Retry connection by calling init recursively but we need to handle cleanup first
                   // Or simpler: reload the module/tab content
                   // Best approach: Just reconnect logic here
                   
                   try {
                        const newSessionResult = await window.electronAPI.connection.connect(hostInfo);
                        if (newSessionResult.status !== 'error') {
                             // Update session Id references
                             // WARNING: This is tricky because listeners are bound to old ID.
                             // It is safer to reload the tab/drawer content or re-init logic.
                             // Let's trigger a re-init if possible or just inform user to reconnect manually if complex
                             // User asked for auto retry.
                             
                             // Since listeners are bound to `currentSessionId` variable which is const, we cannot update it easily to affect existing listeners.
                             // We should ideally reload the tab.
                             const tabId = containerId.replace('terminal-', '');
                             const tab = window.TabManager.tabs.find(t => t.id === tabId);
                             if (tab && tab.sessionObj && typeof tab.sessionObj.dispose === 'function') {
                                 tab.sessionObj.dispose();
                             }
                             
                             // Re-init
                             term.clear();
                             if (window.ConnectionModule) {
                                 const newSessionObj = await window.ConnectionModule.init(containerId, hostInfo);
                                 if(tab) tab.sessionObj = newSessionObj;
                             }
                        } else {
                            term.writeln(`\x1b[31mReconnect failed: ${newSessionResult.message}\x1b[0m`);
                        }
                   } catch (e) {
                       term.writeln(`\x1b[31mReconnect error: ${e.message}\x1b[0m`);
                   }
                }, 3000);
            }
        });

        // Frontend -> Backend (Input)
        term.onData(data => {
            window.electronAPI.send('term-input', { sessionId: currentSessionId, data });
        });

        function sendResize() {
            // Container görünür değilse veya boyutları 0 ise işlem yapma
            if (!container.clientWidth || !container.clientHeight) return;

            // Fit addon ile boyutları hesapla
            fitAddon.fit();

            // Backend'e yeni boyutları bildir
            // window.electronAPI.send kontrolü
            if (window.electronAPI && window.electronAPI.send) {
                window.electronAPI.send('term-resize', {
                    sessionId: currentSessionId,
                    cols: term.cols,
                    rows: term.rows
                });
            }
        }

        // ResizeObserver ile container boyut değişimlerini izle (Sidebar aç/kapa dahil)
        const resizeObserver = new ResizeObserver(() => {
            // RequestAnimationFrame ile UI thread'i boğmadan resize yap
            requestAnimationFrame(() => sendResize());
        });

        resizeObserver.observe(container);

        // İlk yüklemede ve SSH hazır olduğunda da tetikle
        window.electronAPI.on('ssh-ready', (event, msg) => {
            if (msg && msg.sessionId === currentSessionId) {
                term.clear(); // Connecting mesajlarını temizle
                sendResize();
            }
        });
        // window.addEventListener('resize', sendResize); // ResizeObserver bunu zaten halleder

        // İlk bir kez çalıştır (zamanlama sorunu olmaması için kısa gecikme)
        setTimeout(sendResize, 100);


        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey) {
                // Ctrl + veya Ctrl = (Numpad + dahil)
                if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
                    e.preventDefault();
                    term.options.fontSize = term.options.fontSize + 1;
                    fitAddon.fit();
                    window.electronAPI.send('term-resize', { sessionId: currentSessionId, cols: term.cols, rows: term.rows });
                }
                // Ctrl - (Numpad - dahil)
                else if (e.key === '-' || e.code === 'NumpadSubtract') {
                    e.preventDefault();
                    if (term.options.fontSize > 6) { // Minimum 6px
                        term.options.fontSize = term.options.fontSize - 1;
                        fitAddon.fit();
                        window.electronAPI.send('term-resize', { sessionId: currentSessionId, cols: term.cols, rows: term.rows });
                    }
                }
            }
        });

        if (TerminalSettings.rightClickCopyPaste) { // Sağ tık ile yapıştırma
            container.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const text = clipboard.readText();
                if (text) {
                    term.paste(text);
                }
            }); term.onSelectionChange(() => {
                const selection = term.getSelection();
                if (selection) {
                    clipboard.writeText(selection);
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
                // Observer'ı durdur
                if (resizeObserver) resizeObserver.disconnect();
                // Terminali temizle
                term.dispose();
                // Backend'e kapat isteği gönder (İstenirse)
                window.electronAPI.send('term-close', { sessionId: currentSessionId });
            }
        };
    }
};
