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

if (!db.get('terminalSettings')) {
  db.set("terminalSettings", {
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