const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { Client } = require('ssh2');
const net = require('net');

require('dotenv').config({ path: path.join(__dirname, '.env') });

let mainWindow;
let sshStream;

const ip = process.env.SSH_IP || '40.81.229.132'
const username = process.env.SSH_USER || 'idk'
const password = process.env.SSH_PASS || 'idk'
const SSH_PORT = process.env.SSH_PORT ? parseInt(process.env.SSH_PORT) : 22;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');

  const conn = new Client();
  
  conn.on('ready', () => {
    console.log('SSH Bağlantısı Hazır');
    mainWindow.setTitle('40.81.229.132 - Bağlandı');
    mainWindow.webContents.send('term-data', '\r\n*** SSH BAĞLANTISI KURULDU ***\r\n');
    
    // Renkler ve düzgün terminal davranışı için xterm-256color kullanıyoruz
    conn.shell({ term: 'xterm-256color', rows: 24, cols: 80 }, (err, stream) => {
      if (err) {
        mainWindow.webContents.send('term-data', '\r\n*** SHELL HATASI: ' + err.message + ' ***\r\n');
        return conn.end();
      }
      
      sshStream = stream;
      mainWindow.webContents.send('ssh-ready');

      stream.on('close', () => {
        console.log('Stream kapandı');
        conn.end();
        mainWindow.setTitle('40.81.229.132 - Bağlantı Koptu');
        mainWindow.webContents.send('term-data', '\r\n*** BAĞLANTI KOPTU ***\r\n');
      }).on('data', (data) => {
        mainWindow.webContents.send('term-data', data.toString());
      });
    });
  }).on('error', (err) => {
    console.error('SSH Hatası:', err);
    if (mainWindow) {
        mainWindow.webContents.send('term-data', '\r\n*** SSH HATASI: ' + err.message + ' ***\r\n');
    }
  });

  // TCP Soketini manuel oluşturup Nagle algoritmasını kapatıyoruz (setNoDelay)
  // Bu, tuş vuruşlarının sunucuya anında gitmesini sağlar.
  const sock = net.createConnection(64732, '20.199.18.171');
  
  sock.on('connect', () => {
      sock.setNoDelay(true); // Gecikmeyi önleyen sihirli ayar
  });

  sock.on('error', (err) => {
      console.error('Socket Hatası:', err);
      if (mainWindow) {
          mainWindow.webContents.send('term-data', '\r\n*** BAĞLANTI HATASI: ' + err.message + ' ***\r\n');
      }
  });

  conn.connect({
    sock: sock,
    username: 'Kubilay',
    password: 'Pornhub.com90',
    readyTimeout: 20000,
    keepaliveInterval: 1000, // Daha sık kontrol etsin
    algorithms: {
        cipher: [
            'aes128-ctr',
            'aes192-ctr',
            'aes256-ctr',
            'aes128-gcm'
        ]
    }
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

ipcMain.on('term-input', (event, data) => {
  if (sshStream) {
    sshStream.write(data);
  }
});

ipcMain.on('term-resize', (event, size) => {
    if (sshStream) {
        sshStream.setWindow(size.rows, size.cols, size.height, size.width);
    }
});
