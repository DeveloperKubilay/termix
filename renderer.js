const { ipcRenderer, clipboard } = require('electron');
const { Terminal } = require('xterm');
const { FitAddon } = require('xterm-addon-fit');

const term = new Terminal({
    cursorBlink: true,
    fontFamily: 'Consolas, "Courier New", monospace',
    fontSize: 14,
    scrollback: 5000, // Geriye dönük satır sayısı
    theme: {
        background: '#000000',
        foreground: '#cccccc', // Standart yazı rengi (White)
        cursor: '#cccccc',
        selectionBackground: '#797979',
        
        // Normal Renkler
        black: '#000000',
        red: '#c50f1f',
        green: '#1d8e48', // Senin yeşil
        yellow: '#c19c00',
        blue: '#0020c7',  // Senin mavi
        magenta: '#881798',
        cyan: '#3a96dd',
        white: '#cccccc',

        // Parlak Renkler
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

const fitAddon = new FitAddon();
term.loadAddon(fitAddon);

term.open(document.getElementById('terminal'));
fitAddon.fit();

term.onData(data => {
    ipcRenderer.send('term-input', data);
});

// Seçim yapıldığında otomatik kopyala
term.onSelectionChange(() => {
    const selection = term.getSelection();
    if (selection) {
        clipboard.writeText(selection);
    }
});

ipcRenderer.on('term-data', (event, data) => {
    term.write(data);
});

window.addEventListener('resize', () => {
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
});

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

// Sağ tık ile yapıştırma
window.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const text = clipboard.readText();
    if (text) {
        // term.paste() kullanıyoruz ki bracketed paste mode gibi özellikler çalışsın
        term.paste(text);
    }
});
