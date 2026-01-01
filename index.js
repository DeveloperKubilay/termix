const { app, BrowserWindow } = require('electron');
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

function main() {
  let mainWindow = new BrowserWindow({
    width: 900,
    height: 600,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'util/ipc-preloader.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}