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

        // WebGL Addon for better rendering performance and font sharpness
        try {
            const webglAddon = new window.WebglAddon.WebglAddon();
            webglAddon.onContextLoss(e => {
                webglAddon.dispose();
            });
            term.loadAddon(webglAddon);
        } catch (e) {
            console.warn("WebGL addon could not be loaded", e);
        }

        term.open(container);



        term.writeln(`Connecting to ${hostInfo.username}@${hostInfo.hostname || hostInfo.name}...`);
        const sessionResult = await window.electronAPI.connection.connect(hostInfo);
        const currentSessionId = sessionResult.sessionId;

        // Backend -> Frontend (Output)
        window.electronAPI.on('term-data', (event, msg) => {
            if (msg && msg.sessionId === currentSessionId) {
                term.write(msg.data);
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
