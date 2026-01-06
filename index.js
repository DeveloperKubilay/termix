const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

const { loadIPC } = require('./util/ipc-loader');

app.whenReady().then(() => {
  main();
  const channels = loadIPC();
  console.log('Loaded IPC channels:', channels.length);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

const kubitdb = require('kubitdb');
const db = new kubitdb();

global.Terminals = {}

if (!db.get('terminalSettings') || db.get('terminalSettings').fontFamily.includes('Consolas')) {
  // Force update if old defaults or missing
  db.set("terminalSettings", {
    cursorBlink: true,
    fontFamily: '"JetBrains Mono", "Fira Code", Consolas, "Courier New", monospace',
    rightClickCopyPaste: true,
    fontSize: 14,
    fontWeight: 500,
    letterSpacing: 0,
    lineHeight: 1.2,
    scrollback: 5000, 
    theme: {
      background: '#1e1e1e', // VS Code Dark+ benzeri
      foreground: '#d4d4d4', // Standart yazı rengi (White)
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
  })
}

function main() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const savedBounds = db.get('windowBounds') || {};
  
  let mainWindow = new BrowserWindow({
    width: savedBounds.width || Math.round(width * 0.70),
    height: savedBounds.height || Math.round(height * 0.75),
    x: savedBounds.x,
    y: savedBounds.y,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'util/ipc-preloader.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.on('close', () => {
    db.set('windowBounds', mainWindow.getBounds());
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

// Global Terminal Input Handler
const { ipcMain } = require('electron');

// Frontend -> Backend (Input)
ipcMain.on('term-input', (event, payload) => {
    const { sessionId, data } = payload;
    const session = global.Terminals[sessionId];
    if (session) {
        session.write({ type: 'input', message: data });
    }
});

// Frontend -> Backend (Resize)
ipcMain.on('term-resize', (event, payload) => {
    const { sessionId, cols, rows } = payload;
    const session = global.Terminals[sessionId];
    if (session) {
        session.write({ type: 'resize', cols, rows });
    }
});

// Frontend -> Backend (Close/Disconnect)
ipcMain.on('term-close', (event, payload) => {
    const { sessionId } = payload;
    const session = global.Terminals[sessionId];
    if (session) {
        try {
            session.end(); // SSH bağlantısını kapat
            delete global.Terminals[sessionId]; // Listeden sil
        } catch (e) {
            console.error("Error closing session:", e);
        }
    }
});