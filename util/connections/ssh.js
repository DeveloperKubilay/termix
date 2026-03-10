const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const db = require('../profile-db');

const SSH_PORT_MIN = 1;
const SSH_PORT_MAX = 65535;
const SSH_PORT_FALLBACK = 22;
const SSH_READY_TIMEOUT_MS = 20000;
const SSH_KEEPALIVE_INTERVAL_MS = 10000;
const SSH_KEEPALIVE_COUNT_MAX = 6;

function parseSshPort(value, fallback = SSH_PORT_FALLBACK) {
    const candidate = value == null || String(value).trim() === '' ? fallback : value;
    const parsed = Number(candidate);
    if (!Number.isInteger(parsed) || parsed < SSH_PORT_MIN || parsed > SSH_PORT_MAX) {
        throw new Error(`SSH port must be between ${SSH_PORT_MIN} and ${SSH_PORT_MAX}.`);
    }
    return parsed;
}

function loadPrivateKey(certPath) {
    const normalizedPath = String(certPath || '').trim();
    if (!normalizedPath) return null;

    let keyPath = normalizedPath;
    if (!path.isAbsolute(keyPath)) {
        const relativeInFiles = path.join(process.cwd(), 'files', keyPath);
        if (fs.existsSync(relativeInFiles)) {
            keyPath = relativeInFiles;
        }
    }

    return fs.readFileSync(keyPath);
}

function verifyAndPersistHost(data, port, hashedKey) {
    const key = Buffer.isBuffer(hashedKey)
        ? hashedKey.toString('hex')
        : String(hashedKey || '');

    let knownHosts;
    try {
        knownHosts = db.get('knownHosts');
    } catch (_) {
        knownHosts = [];
    }

    if (!Array.isArray(knownHosts)) {
        knownHosts = [];
    }

    const hostEntry = knownHosts.find((item) => {
        return item.address === data.address && Number(item.port) === port;
    });

    if (hostEntry) {
        return hostEntry.key === key;
    }

    knownHosts.push({
        address: data.address,
        port,
        key,
        firstSeen: Date.now()
    });

    try {
        db.set('knownHosts', knownHosts);
    } catch (err) {
        console.error('Failed to save known_hosts:', err);
    }

    return true;
}

module.exports = (data) => {
    return new Promise((resolve, reject) => {
        const sessionId = `${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        const conn = new Client();
        const emitter = new EventEmitter();
        let stream = null;
        let settled = false;
        let disconnected = false;
        let lastDisconnectInfo = {
            exitCode: null,
            signal: null,
            message: null
        };

        const sendToFrontend = (msg) => {
            emitter.emit('data', msg);
        };

        const resolveOnce = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };

        const rejectOnce = (err) => {
            if (settled) return;
            settled = true;
            reject(err);
        };

        const updateDisconnectInfo = (patch = {}) => {
            lastDisconnectInfo = {
                ...lastDisconnectInfo,
                ...patch
            };
        };

        const emitDisconnect = (patch = {}) => {
            if (disconnected) return;
            disconnected = true;
            updateDisconnectInfo(patch);

            const payload = {
                type: 'disconnected',
                exitCode: lastDisconnectInfo.exitCode
            };

            if (lastDisconnectInfo.signal) {
                payload.signal = lastDisconnectInfo.signal;
            }

            if (lastDisconnectInfo.message) {
                payload.message = lastDisconnectInfo.message;
            }

            sendToFrontend(payload);
        };

        conn.on('ready', () => {
            try {
                conn.setNoDelay(true);
            } catch (_) {}

            sendToFrontend({ type: "connected" });

            // Default SSH shell options
            conn.shell({ term: 'xterm-256color', rows: 24, cols: 80 }, (err, shellStream) => {
                if (err) {
                    sendToFrontend({ type: "error", message: err.message });
                    try {
                        conn.end();
                    } catch (_) {}
                    rejectOnce(err);
                    return;
                }

                stream = shellStream;

                const writeToStream = (data) => {
                    if (!stream) return;
                    if (data.type === "input") {
                        stream.write(data.message);
                    } else if (data.type === "resize") {
                        stream.setWindow(data.rows, data.cols, data.height || 0, data.width || 0);
                    }
                };

                stream.on('exit', (code, signal) => {
                    updateDisconnectInfo({
                        exitCode: Number.isFinite(Number(code)) ? Number(code) : null,
                        signal: signal || null
                    });
                }).on('close', (code, signal) => {
                    updateDisconnectInfo({
                        exitCode: Number.isFinite(Number(code)) ? Number(code) : lastDisconnectInfo.exitCode,
                        signal: signal || lastDisconnectInfo.signal
                    });
                    emitDisconnect();
                    try {
                        conn.end();
                    } catch (_) {}
                }).on('data', (d) => {
                    sendToFrontend({ type: "data", data: d.toString() });
                });

                if (stream.stderr && typeof stream.stderr.on === 'function') {
                    stream.stderr.on('data', (d) => {
                        sendToFrontend({ type: "data", data: d.toString() });
                    });
                }

                resolveOnce({
                    sessionId: sessionId,
                    on: (evt, cb) => emitter.on(evt, cb),
                    write: writeToStream,
                    end: () => conn.end()
                });
            });
        }).on('error', (err) => {
            const message = err && err.message ? err.message : 'SSH connection failed.';
            sendToFrontend({ type: "error", message });

            if (!settled) {
                rejectOnce(err);
                return;
            }

            updateDisconnectInfo({ message });
            emitDisconnect();
        }).on('close', () => {
            if (!settled) {
                rejectOnce(new Error(lastDisconnectInfo.message || 'SSH connection closed.'));
                return;
            }

            emitDisconnect();
        });

        try {
            const port = parseSshPort(data.port);
            const connectConfig = {
                host: String(data.address || '').trim(),
                port,
                username: data.username,
                readyTimeout: SSH_READY_TIMEOUT_MS,
                keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
                keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
                hostVerifier: (hashedKey) => {
                    const verified = verifyAndPersistHost(data, port, hashedKey);
                    if (!verified) {
                        sendToFrontend({ type: "error", message: `SECURITY WARNING: Host key verification failed! Connection rejected as a security precaution.` });
                        return false;
                    }
                    return true;
                },
                algorithms: {
                    cipher: [
                        'aes128-ctr',
                        'aes192-ctr',
                        'aes256-ctr',
                        'aes128-gcm',
                        'aes256-gcm',
                        'aes128-cbc',
                        'aes256-cbc',
                        '3des-cbc'
                    ]
                }
            };

            if (data.password) {
                connectConfig.password = data.password;
            }

            const certPath = String(data.certPath || '').trim();
            if (certPath) {
                try {
                    connectConfig.privateKey = loadPrivateKey(certPath);
                } catch (err) {
                    throw new Error(`Private key cannot be read: ${err.message}`);
                }
            }

            if (!connectConfig.password && !connectConfig.privateKey) {
                throw new Error('Selected host has no password or private key.');
            }

            if (!connectConfig.host) {
                throw new Error('Selected host has no address.');
            }

            conn.connect(connectConfig);
        } catch (e) {
            rejectOnce(e);
        }
    });
};

