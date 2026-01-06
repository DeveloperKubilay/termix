const { EventEmitter } = require('events');
const os = require('os');

module.exports = (data) => {
    return new Promise((resolve, reject) => {
        // Dependencies check
        try {
            require.resolve('node-pty');
        } catch (e) {
            return reject(new Error('node-pty module not found. Please install it with: npm install node-pty'));
        }

        const pty = require('node-pty');
        
        const sessionId = Date.now();
        const emitter = new EventEmitter();

        const sendToFrontend = (msg) => {
            emitter.emit('data', msg);
        };

        const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
        
        // Use user provided shell if available
        const targetShell = data.shell || shell;

        // Powershell için profili atla (-NoProfile) ki takılmaları önlesin
        const args = (targetShell.includes('powershell') && os.platform() === 'win32') 
            ? ['-NoProfile', '-ExecutionPolicy', 'Bypass'] 
            : [];

        // Fix hanging: Validate CWD.
        let spawnCwd = process.env.HOME || process.env.USERPROFILE;
        const fs = require('fs');
        if (!spawnCwd || !fs.existsSync(spawnCwd)) {
            spawnCwd = os.tmpdir();
        }
        
        // Temiz Environment (Gereksiz değişkenleri temizle)
        const safeEnv = { ...process.env };
        // Electron ile ilgili bazı değişkenler terminali bozabilir, gerekirse filtrele

        try {
            const ptyProcess = pty.spawn(targetShell, args, {
                name: 'xterm-256color',
                cols: 80,
                rows: 24,
                cwd: spawnCwd,
                env: safeEnv,
                useConpty: false // ConPTY bazen Electron'da donmaya sebep olur, WinPTY daha stabil (legacy)
            });

            sendToFrontend({ type: "connected" });

            ptyProcess.onData((data) => {
                sendToFrontend({ type: "data", data: data });
            });

            ptyProcess.onExit(() => {
                sendToFrontend({ type: "disconnected" });
            });

            const writeToStream = (msg) => {
                if (msg.type === "input") {
                    ptyProcess.write(msg.message);
                } else if (msg.type === "resize") {
                    ptyProcess.resize(msg.cols, msg.rows);
                }
            };

            resolve({
                sessionId: sessionId,
                on: (evt, cb) => emitter.on(evt, cb),
                write: writeToStream,
                end: () => {
                    ptyProcess.kill();
                }
            });

        } catch (err) {
            sendToFrontend({ type: "error", message: err.message });
            reject(err);
        }
    });
};
