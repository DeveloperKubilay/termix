const fs = require('fs');
const { app, BrowserWindow, nativeImage, screen } = require('electron');
const path = require('path');

const { loadIPC } = require('./util/ipc-loader');
const profileManager = require('./util/profile-manager');
const portForwardManager = require('./util/port-forwarding/manager');
const sftpManager = require('./util/sftp/manager');
const { enqueueProfileSync } = require('./util/cloud-sync');
const updater = require('./util/updater');

function getAppIcon() {
  const iconPath = path.join(__dirname, 'public/icons/favicon.ico');
  if (!fs.existsSync(iconPath)) return undefined;
  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? undefined : icon;
}

app.whenReady().then(async () => {
  const appIcon = getAppIcon();

  if (process.platform === 'darwin' && app.dock && appIcon) {
    app.dock.setIcon(appIcon);
  }

  try {
    await enqueueProfileSync('pull', {
      source: 'app-startup',
      timeoutMs: 15000
    });
  } catch (err) {
    console.error('Failed to pull cloud data on startup:', err);
  }

  main();
  updater.init();
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

let isQuitInProgress = false;

app.on('before-quit', (event) => {
  if (isQuitInProgress) {
    return;
  }

  event.preventDefault();
  isQuitInProgress = true;

  (async () => {
    try {
      profileManager.persistActiveProfileData();
    } catch (err) {
      console.error('Failed to persist active profile:', err);
    }

    try {
      await enqueueProfileSync('push', {
        source: 'app-shutdown',
        timeoutMs: 15000
      });
    } catch (err) {
      console.error('Failed to push cloud data on shutdown:', err);
    }

    try {
      await portForwardManager.stopAllForwards();
    } catch (err) {
      console.error('Failed to stop active port forwards:', err);
    }

    try {
      await sftpManager.disconnectAll();
    } catch (err) {
      console.error('Failed to close active SFTP sessions:', err);
    }

    app.quit();
  })();
});

function main() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const savedBounds = db.get('windowBounds') || {};
  const appIcon = getAppIcon();

  let mainWindow = new BrowserWindow({
    width: savedBounds.width || Math.round(width * 0.75),
    height: savedBounds.height || Math.round(height * 0.75),
    x: savedBounds.x,
    y: savedBounds.y,
    autoHideMenuBar: true,
    icon: appIcon,
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
