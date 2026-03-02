const { Client } = require('ssh2');
const net = require('net');
const { EventEmitter } = require('events');
const db = require('../profile-db');
const SSH_PORT_MIN = 1;
const SSH_PORT_MAX = 65535;
const SSH_PORT_FALLBACK = 22;

function parseSshPort(value, fallback = SSH_PORT_FALLBACK) {
    const candidate = value == null || String(value).trim() === '' ? fallback : value;
    const parsed = Number(candidate);
    if (!Number.isInteger(parsed) || parsed < SSH_PORT_MIN || parsed > SSH_PORT_MAX) {
        throw new Error(`SSH port must be between ${SSH_PORT_MIN} and ${SSH_PORT_MAX}.`);
    }
    return parsed;
}

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

                stream.on('close', (code, signal) => {
                    conn.end();
                    sendToFrontend({ type: "disconnected", exitCode: code });
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
            const port = parseSshPort(data.port);
            const sock = net.createConnection(port, data.address);
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
                hostVerifier: (hashedKey) => {
                    const key = hashedKey.toString('hex');
                    let knownHosts;
                    try {
                        knownHosts = db.get("knownHosts");
                    } catch (e) {
                        knownHosts = [];
                    }
                    if (!Array.isArray(knownHosts)) knownHosts = [];

                    const hostEntry = knownHosts.find(h => h.address === data.address && Number(h.port) === port);

                    if (hostEntry) {
                        if (hostEntry.key === key) return true;
                        sendToFrontend({ type: "error", message: `SECURITY WARNING: Host key verification failed! Connection rejected as a security precaution.` });
                        return false;
                    }

                    // Trust On First Use (TOFU)
                    knownHosts.push({
                        address: data.address,
                        port,
                        key: key,
                        firstSeen: Date.now()
                    });
                    
                    try {
                        db.set("knownHosts", knownHosts);
                    } catch(e) {
                        console.error('Failed to save known_hosts:', e);
                    }
                    
                    return true;
                },
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

