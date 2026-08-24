const { Client } = require('ssh2');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { buildConnectConfig } = require('./ssh-common');

function createSessionId() {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return crypto.randomBytes(16).toString('hex');
}

function parseTerminalDimension(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = (data) => {
    return new Promise((resolve, reject) => {
        const sessionId = createSessionId();
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

            // Open the shell with the actual terminal dimensions supplied by the
            // frontend so that the server formats its initial output correctly.
            const initialCols = parseTerminalDimension(data.initialCols, 80);
            const initialRows = parseTerminalDimension(data.initialRows, 24);
            conn.shell({ term: 'xterm-256color', rows: initialRows, cols: initialCols }, (err, shellStream) => {
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
                    try {
                        if (data.type === "input") {
                            stream.write(data.message);
                        } else if (data.type === "resize") {
                            stream.setWindow(data.rows, data.cols, data.height || 0, data.width || 0);
                        }
                    } catch (_) {}
                };

                stream.on('error', (streamErr) => {
                    // Prevent unhandled stream error crashes
                    const message = streamErr && streamErr.message ? streamErr.message : 'SSH stream error.';
                    updateDisconnectInfo({ message });
                });

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
                    try {
                        sendToFrontend({ type: "data", data: d.toString() });
                    } catch (_) {}
                });

                if (stream.stderr && typeof stream.stderr.on === 'function') {
                    stream.stderr.on('error', () => {});
                    stream.stderr.on('data', (d) => {
                        try {
                            sendToFrontend({ type: "data", data: d.toString() });
                        } catch (_) {}
                    });
                }

                resolveOnce({
                    sessionId: sessionId,
                    on: (evt, cb) => emitter.on(evt, cb),
                    write: writeToStream,
                    end: () => {
                        try {
                            if (stream && typeof stream.end === 'function') stream.end();
                        } catch (_) {}
                        try {
                            conn.end();
                        } catch (_) {}
                    }
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
            const connectConfig = buildConnectConfig(data, () => {
                sendToFrontend({ type: "error", message: `SECURITY WARNING: Host key verification failed! Connection rejected as a security precaution.` });
            });

            conn.connect(connectConfig);
        } catch (e) {
            rejectOnce(e);
        }
    });
};
