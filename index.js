const fs = require('fs');
const { app, BrowserWindow, nativeImage, screen, ipcMain } = require('electron');
const path = require('path');

const { loadIPC } = require('./util/ipc-loader');
const profileManager = require('./util/profile-manager');
const portForwardManager = require('./util/port-forwarding/manager');
const sftpManager = require('./util/sftp/manager');
const { enqueueProfileSync } = require('./util/cloud-sync');
const updater = require('./util/updater');
const mcpServer = require('./util/mcp/server');
const mcpSessionStore = require('./util/mcp/session-store');
const sshExec = require('./util/connections/ssh-exec');
const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  let mainWindow = null;
  let isQuitInProgress = false;
  global.Terminals = {};

  profileManager.ensureInitialized();
  const db = require("./util/startDb")();
  profileManager.persistActiveProfileData();

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

    createMainWindow(db);
    updater.init();
    const channels = loadIPC();
    console.log('Loaded IPC channels:', channels.length);

    try {
      await mcpServer.init({ getMainWindow: () => mainWindow });
    } catch (err) {
      console.error('Failed to start MCP server:', err);
    }
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      createMainWindow(db);
      return;
    }
    try {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    } catch (err) {
      console.error('Failed to focus existing window on second-instance event:', err);
      createMainWindow(db);
    }
  });

  app.on('before-quit', (event) => {
    if (updater.isInstallingUpdate()) {
      isQuitInProgress = true;
      return;
    }

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
        closeAllTerminals();
      } catch (err) {
        console.error('Failed to close active terminals:', err);
      }

      try {
        await mcpServer.stop();
      } catch (err) {
        console.error('Failed to stop MCP server:', err);
      }

      try {
        sshExec.closeAll();
      } catch (err) {
        console.error('Failed to close pooled SSH connections:', err);
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

  function closeAllTerminals() {
    if (!global.Terminals) return;
    const sessionIds = Object.keys(global.Terminals);
    for (const sessionId of sessionIds) {
      try {
        const session = global.Terminals[sessionId];
        if (session && typeof session.end === 'function') {
          session.end();
        }
        mcpSessionStore.remove(sessionId);
      } catch (err) {
        console.warn('Error closing terminal session on exit:', err);
      }
      delete global.Terminals[sessionId];
    }
  }

  function createMainWindow(store) {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;
    const savedBounds = store.get('windowBounds') || {};
    const appIcon = getAppIcon();

    mainWindow = new BrowserWindow({
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
      try {
        store.set('windowBounds', mainWindow.getBounds());
      } catch (_) {}
    });
    mainWindow.on('closed', () => {
      mainWindow = null;
      closeAllTerminals();
    });

    mainWindow.setMenuBarVisibility(false);
    mainWindow.loadFile(path.join(__dirname, 'index.html'));
  }

  // Frontend -> Backend (Input)
  ipcMain.on('term-input', (event, payload) => {
    try {
      const { sessionId, data } = payload || {};
      const session = global.Terminals && global.Terminals[sessionId];
      if (session && typeof session.write === 'function') {
        session.write({ type: 'input', message: data });
      }
    } catch (e) {
      console.warn("Error writing term input:", e);
    }
  });

  // Frontend -> Backend (Resize)
  ipcMain.on('term-resize', (event, payload) => {
    try {
      const { sessionId, cols, rows } = payload || {};
      const session = global.Terminals && global.Terminals[sessionId];
      if (session && typeof session.write === 'function') {
        session.write({ type: 'resize', cols, rows });
      }
    } catch (e) {
      console.warn("Error resizing terminal:", e);
    }
  });

  // Frontend -> Backend (Close/Disconnect)
  ipcMain.on('term-close', (event, payload) => {
    try {
      const { sessionId } = payload || {};
      const session = global.Terminals && global.Terminals[sessionId];
      if (session) {
        try {
          if (typeof session.end === 'function') {
            session.end();
          }
          mcpSessionStore.remove(sessionId);
          delete global.Terminals[sessionId];
        } catch (e) {
          console.error("Error closing session:", e);
        }
      }
    } catch (err) {
      console.warn("Error handling term-close IPC:", err);
    }
  });
}

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

function getAppIcon() {
  const iconPath = path.join(__dirname, 'public/icons/favicon.ico');
  if (!fs.existsSync(iconPath)) return undefined;
  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? undefined : icon;
}
