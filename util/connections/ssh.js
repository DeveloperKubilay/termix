const { Client } = require('ssh2');
const net = require('net');
const { EventEmitter } = require('events');

module.exports = (data) => {
    return new Promise((resolve, reject) => {
        const sessionId = Date.now();
        const conn = new Client();
        const emitter = new EventEmitter();

        const sendToFrontend = (msg) => {
            emitter.emit('data', msg);
        };

        conn.on('ready', () => {
            sendToFrontend({ type: "connected" });

            // Default SSH shell options
            conn.shell({ term: 'xterm-256color', rows: 24, cols: 80 }, (err, stream) => {
                if (err) {
                    sendToFrontend({ type: "error", message: err.message });
                    conn.end();
                    return;
                }

                const writeToStream = (data) => {
                    if (data.type === "input") {
                        stream.write(data.message);
                    } else if (data.type === "resize") {
                        stream.setWindow(data.rows, data.cols, data.height || 0, data.width || 0);
                    }
                };

                stream.on('close', () => {
                    conn.end();
                    sendToFrontend({ type: "disconnected" });
                }).on('data', (d) => {
                    sendToFrontend({ type: "data", data: d.toString() });
                });

                resolve({
                    sessionId: sessionId,
                    on: (evt, cb) => emitter.on(evt, cb),
                    write: writeToStream,
                    end: () => conn.end()
                });
            });
        }).on('error', (err) => {
            sendToFrontend({ type: "error", message: err.message });
        });

        // Socket logic
        try {
            const sock = net.createConnection(data.port, data.address);
            sock.on('connect', () => {
                sock.setNoDelay(true);
            });
            sock.on('error', (err) => {
                console.error('Socket Hatası:', err);
                sendToFrontend({ type: "error", message: err.message });
                reject(err);
            });

            conn.connect({
                sock: sock,
                username: data.username,
                password: data.password,
                readyTimeout: 20000,
                keepaliveInterval: 1000,
                algorithms: {
                    cipher: [
                        'aes128-ctr',
                        'aes192-ctr',
                        'aes256-ctr',
                        'aes128-gcm'
                    ]
                }
            });
        } catch (e) {
            reject(e);
        }
    });
};
