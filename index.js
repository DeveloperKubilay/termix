const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

const { loadIPC } = require('./util/ipc-loader');
const profileManager = require('./util/profile-manager');
const portForwardManager = require('./util/port-forwarding/manager');
const sftpManager = require('./util/sftp/manager');

app.whenReady().then(() => {
  main();
  const channels = loadIPC();
  console.log('Loaded IPC channels:', channels.length);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

profileManager.ensureInitialized();
const db = require("./util/startDb")();
profileManager.persistActiveProfileData();
global.Terminals = {}

app.on('before-quit', () => {
  try {
    profileManager.persistActiveProfileData();
  } catch (err) {
    console.error('Failed to persist active profile:', err);
  }

  portForwardManager.stopAllForwards().catch((err) => {
    console.error('Failed to stop active port forwards:', err);
  });

  sftpManager.disconnectAll().catch((err) => {
    console.error('Failed to close active SFTP sessions:', err);
  });
});

function main() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const savedBounds = db.get('windowBounds') || {};

  let mainWindow = new BrowserWindow({
    width: savedBounds.width || Math.round(width * 0.60),
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
