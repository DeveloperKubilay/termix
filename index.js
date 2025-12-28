const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  main();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function main() {
  let mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}