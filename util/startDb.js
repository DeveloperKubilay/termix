const kubitdb = require('kubitdb');
const db = new kubitdb();

module.exports = function () {
  if(db.get("type") === undefined) {
    db.set("type", "local");
  }
  if (!db.get('terminalSettings')) {
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

  return db;
}