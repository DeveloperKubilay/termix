window.ConnectionModule = {
    init: async function (containerId, hostInfo) {
        if (!containerId) return;
        const container = document.getElementById(containerId);
        if (!container) return;

        const term = new window.Terminal(await window.electronAPI.connection.getSettings());

        const fitAddon = new window.FitAddon.FitAddon();
        term.loadAddon(fitAddon);

        term.open(container);

        setTimeout(() => {
            fitAddon.fit();
        }, 100);


        term.writeln(`Connecting to ${hostInfo.username}@${hostInfo.hostname || hostInfo.name}...`);
        const session = await window.electronAPI.connection.connect(hostInfo)
        /*ipcRenderer.on('term-data', (event, data) => {
            term.write(data);
        });
        term.onData(data => {
            ipcRenderer.send('term-input', data);
        });
        */






        /* window.addEventListener('resize', () => {
             fitAddon.fit();
             ipcRenderer.send('term-resize', {
                 cols: term.cols,
                 rows: term.rows
             });
         });
         
         // SSH bağlantısı hazır olduğunda boyut bilgisini gönder
         ipcRenderer.on('ssh-ready', () => {
             fitAddon.fit();
             ipcRenderer.send('term-resize', {
                 cols: term.cols,
                 rows: term.rows
             });
         });*/


        /*
        
        // Zoom kontrolleri (Ctrl + / Ctrl -)
        window.addEventListener('keydown', (e) => {
            if (e.ctrlKey) {
                // Ctrl + veya Ctrl = (Numpad + dahil)
                if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
                    e.preventDefault();
                    term.options.fontSize = term.options.fontSize + 1;
                    fitAddon.fit();
                    ipcRenderer.send('term-resize', { cols: term.cols, rows: term.rows });
                } 
                // Ctrl - (Numpad - dahil)
                else if (e.key === '-' || e.code === 'NumpadSubtract') {
                    e.preventDefault();
                    if (term.options.fontSize > 6) { // Minimum 6px
                        term.options.fontSize = term.options.fontSize - 1;
                        fitAddon.fit();
                        ipcRenderer.send('term-resize', { cols: term.cols, rows: term.rows });
                    }
                }
            }
        });
        
        */

        // Sağ tık ile yapıştırma
        container.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const text = clipboard.readText();
            if (text) {
                // term.paste() kullanıyoruz ki bracketed paste mode gibi özellikler çalışsın
                term.paste(text);
            }
        });

        term.onSelectionChange(() => {
            const selection = term.getSelection();
            if (selection) {
                clipboard.writeText(selection);
            }
        });
        const resizeObserver = new ResizeObserver(() => {
            fitAddon.fit();
        });
        resizeObserver.observe(container);

        container.term = term;
        container.fitAddon = fitAddon;
        return { term, fitAddon, session };
    }
};
