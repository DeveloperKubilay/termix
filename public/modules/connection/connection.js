window.ConnectionModule = {
    init: function(containerId, hostInfo) {
        if (!containerId) return;
        const container = document.getElementById(containerId);
        if (!container) return;

        // Terminal options from oldver/renderer.js
        const term = new window.Terminal({
            cursorBlink: true,
            fontFamily: 'Consolas, "Courier New", monospace',
            fontSize: 14,
            scrollback: 5000,
            theme: {
                background: '#000000',
                foreground: '#cccccc',
                cursor: '#cccccc',
                selectionBackground: '#797979',
                black: '#000000',
                red: '#c50f1f',
                green: '#1d8e48',
                yellow: '#c19c00',
                blue: '#0020c7',
                magenta: '#881798',
                cyan: '#3a96dd',
                white: '#cccccc',
                brightBlack: '#767676',
                brightRed: '#e74856',
                brightGreen: '#16c60c',
                brightYellow: '#f9f1a5',
                brightBlue: '#3b78ff',
                brightMagenta: '#b4009e',
                brightCyan: '#61d6d6',
                brightWhite: '#f2f2f2'
            }
        });

        const fitAddon = new window.FitAddon.FitAddon();
        term.loadAddon(fitAddon);

        term.open(container);
        
        // Wait a bit for layout to settle
        setTimeout(() => {
            fitAddon.fit();
        }, 100);

        term.writeln(`Connecting to ${hostInfo.username}@${hostInfo.hostname || hostInfo.name}...`);
        
        // --- IPC EXAMPLE ---
        // Backend'deki commands/connection/connect.js dosyasını tetikler
        if (window.electronAPI && window.electronAPI.connection && window.electronAPI.connection.connect) {
            term.writeln('Handshaking with backend...');
            
            window.electronAPI.connection.connect(hostInfo)
                .then(result => {
                    // Backend'den gelen cevabı yazdır
                    term.writeln(`\r\n\x1b[32m✔ IPC Success:\x1b[0m ${result.message}`);
                    term.writeln(`Timestamp: ${new Date(result.timestamp).toLocaleTimeString()}`);
                    term.writeln('\r\n$ ');
                })
                .catch(err => {
                    term.writeln(`\r\n\x1b[31m✖ IPC Error:\x1b[0m ${err.message}`);
                });
        } else {
             term.writeln('\r\n\x1b[33m⚠ Warning:\x1b[0m IPC "connection.connect" not found.');
             term.writeln('Did you define the command and RESTART the app?');
        }
        // -------------------
        
        term.writeln('Connection established.'); // Placeholder
        term.writeln(JSON.stringify(hostInfo, null, 2)); // Display host info as placeholder
        
        // Handle resizing
        const resizeObserver = new ResizeObserver(() => {
            fitAddon.fit();
        });
        resizeObserver.observe(container);

        // Store instance
        container.term = term;
        container.fitAddon = fitAddon;
        
        return { term, fitAddon };
    }
};
