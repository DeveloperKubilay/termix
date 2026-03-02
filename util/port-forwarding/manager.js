const fs = require('fs');
const net = require('net');
const path = require('path');
const { Client } = require('ssh2');
const kubitdb = require('kubitdb');
const { decrypt } = require('../crypto');

const db = new kubitdb();

const forwards = new Map();
const sessions = new Map();
const states = new Map();

function normalizeId(id) {
    return String(id);
}

function getArray(key) {
    const value = db.get(key);
    return Array.isArray(value) ? value : [];
}

function getForwardById(forwardId) {
    return forwards.get(normalizeId(forwardId)) || null;
}

function getHostById(hostId) {
    const normalized = normalizeId(hostId);
    const hosts = getArray('hosts');
    const host = hosts.find((item) => normalizeId(item.id) === normalized) || null;
    if (!host) return null;

    const out = { ...host };
    if (out.password) {
        try {
            out.password = decrypt(out.password);
        } catch (_) {
            out.password = '';
        }
    }
    return out;
}

function parsePort(value, label) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error(`${label} must be between 1 and 65535.`);
    }
    return parsed;
}

function getState(forwardId) {
    const normalized = normalizeId(forwardId);
    return states.get(normalized) || {
        status: 'stopped',
        message: 'Stopped',
        updatedAt: Date.now()
    };
}

function setState(forwardId, patch) {
    const normalized = normalizeId(forwardId);
    const next = {
        ...getState(normalized),
        ...patch,
        updatedAt: Date.now()
    };
    states.set(normalized, next);
    return next;
}

function clearState(forwardId) {
    const normalized = normalizeId(forwardId);
    states.delete(normalized);
}

function normalizeHost(value, fallback = '127.0.0.1') {
    const out = String(value || '').trim();
    return out || fallback;
}

function normalizeDirection(value, fallback = 'local_to_remote') {
    const direction = String(value || '').trim().toLowerCase();
    if (direction === 'local_to_remote') {
        return 'local_to_remote';
    }
    return fallback;
}

function listForwards() {
    return Array.from(forwards.values())
        .map((forward) => ({
            ...forward,
            direction: normalizeDirection(forward.direction, 'local_to_remote')
        }))
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
}

function hasPortConflict(payload = {}, exceptId) {
    const direction = normalizeDirection(payload.direction);
    const localHost = normalizeHost(payload.localHost, '127.0.0.1');
    const localPort = Number(payload.localPort);
    const remoteHost = normalizeHost(payload.remoteHost, '127.0.0.1');
    const remotePort = Number(payload.remotePort);
    const hostId = payload.hostId == null ? null : normalizeId(payload.hostId);
    const except = exceptId == null ? null : normalizeId(exceptId);

    for (const forward of forwards.values()) {
        if (except && normalizeId(forward.id) === except) continue;

        const forwardDirection = normalizeDirection(forward.direction);

        if (direction === 'local_to_remote') {
            if (forwardDirection !== 'local_to_remote') continue;

            if (
                normalizeHost(forward.localHost, '127.0.0.1') === localHost &&
                Number(forward.localPort) === localPort
            ) {
                return forward;
            }
            continue;
        }

        if (forwardDirection !== 'remote_to_local') continue;
        if (hostId == null || normalizeId(forward.hostId) !== hostId) continue;

        if (
            normalizeHost(forward.remoteHost, '127.0.0.1') === remoteHost &&
            Number(forward.remotePort) === remotePort
        ) {
            return forward;
        }
    }

    return null;
}

function saveForward(payload) {
    const id = payload && payload.id != null ? payload.id : (Date.now() + Math.floor(Math.random() * 1000));
    const normalized = normalizeId(id);
    const existing = getForwardById(normalized);
    const now = Date.now();
    const direction = normalizeDirection(
        payload.direction,
        existing ? normalizeDirection(existing.direction, 'local_to_remote') : 'remote_to_local'
    );

    const nextForward = {
        id: Number.isFinite(Number(id)) ? Number(id) : id,
        hostId: payload.hostId,
        direction,
        remoteHost: normalizeHost(payload.remoteHost, '127.0.0.1'),
        remotePort: parsePort(payload.remotePort, 'Remote port'),
        localHost: normalizeHost(payload.localHost, '127.0.0.1'),
        localPort: parsePort(payload.localPort, 'Local port'),
        createdAt: existing ? Number(existing.createdAt || now) : now,
        updatedAt: now
    };

    forwards.set(normalized, nextForward);

    if (!states.has(normalized)) {
        setState(normalized, {
            status: 'stopped',
            message: 'Ready',
            stoppedAt: Date.now()
        });
    }

    return nextForward;
}

function verifyAndPersistHost(host, hashedKey) {
    const key = Buffer.isBuffer(hashedKey) ? hashedKey.toString('hex') : String(hashedKey || '');
    let knownHosts = getArray('knownHosts');

    const match = knownHosts.find((item) => {
        return item.address === host.address && Number(item.port) === Number(host.port || 22);
    });

    if (match) {
        return match.key === key;
    }

    knownHosts.push({
        address: host.address,
        port: Number(host.port || 22),
        key,
        firstSeen: Date.now()
    });
    db.set('knownHosts', knownHosts);
    return true;
}

function buildConnectConfig(host, forwardId) {
    const config = {
        host: String(host.address || '').trim(),
        port: parsePort(host.port || 22, 'SSH port'),
        username: String(host.username || 'root').trim() || 'root',
        readyTimeout: 20000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        hostVerifier: (hashedKey) => {
            const verified = verifyAndPersistHost(host, hashedKey);
            if (!verified) {
                setState(forwardId, {
                    status: 'error',
                    message: 'Host key verification failed.'
                });
            }
            return verified;
        }
    };

    const certPath = String(host.certPath || '').trim();
    if (certPath) {
        try {
            let keyPath = certPath;
            if (!path.isAbsolute(keyPath)) {
                const relativeInFiles = path.join(process.cwd(), 'files', keyPath);
                if (fs.existsSync(relativeInFiles)) {
                    keyPath = relativeInFiles;
                }
            }
            config.privateKey = fs.readFileSync(keyPath);
        } catch (err) {
            throw new Error(`Private key cannot be read: ${err.message}`);
        }
    }

    if (host.password) {
        config.password = host.password;
    }

    if (!config.password && !config.privateKey) {
        throw new Error('Selected VDS has no password or private key.');
    }

    if (!config.host) {
        throw new Error('Selected VDS has no address.');
    }

    return config;
}

function closeSocket(server) {
    return new Promise((resolve) => {
        if (!server) {
            resolve();
            return;
        }

        try {
            if (server.listening) {
                let resolved = false;
                const done = () => {
                    if (resolved) return;
                    resolved = true;
                    resolve();
                };

                server.close(() => done());
                setTimeout(done, 1500);
            } else {
                resolve();
            }
        } catch (_) {
            resolve();
        }
    });
}

function destroySessionTraffic(session) {
    if (!session) return;

    if (session.localSockets && session.localSockets.size) {
        for (const socket of session.localSockets) {
            try {
                socket.destroy();
            } catch (_) {}
        }
        session.localSockets.clear();
    }

    if (session.remoteStreams && session.remoteStreams.size) {
        for (const stream of session.remoteStreams) {
            try {
                stream.destroy();
            } catch (_) {}
        }
        session.remoteStreams.clear();
    }
}

async function startForward(forwardId) {
    try {
        const normalized = normalizeId(forwardId);
        if (!normalized || normalized === 'undefined' || normalized === 'null') {
            return { success: false, message: 'Forward id is required.' };
        }

        const existing = sessions.get(normalized);
        if (existing && getState(normalized).status === 'active') {
            return {
                success: true,
                message: 'Forward already active.',
                state: getState(normalized)
            };
        }

        if (existing) {
            await stopForward(normalized);
        }

        const forward = getForwardById(normalized);
        if (!forward) {
            return { success: false, message: 'Forward not found in memory.' };
        }

        const host = getHostById(forward.hostId);
        if (!host) {
            return { success: false, message: 'Selected VDS not found.' };
        }

        const remoteHost = String(forward.remoteHost || '127.0.0.1').trim() || '127.0.0.1';
        const localHost = String(forward.localHost || '127.0.0.1').trim() || '127.0.0.1';
        const remotePort = parsePort(forward.remotePort, 'Remote port');
        const localPort = parsePort(forward.localPort, 'Local port');
        const direction = normalizeDirection(forward.direction);

        const conn = new Client();
        const session = {
            id: normalized,
            direction,
            conn,
            server: null,
            remoteBind: null,
            localSockets: new Set(),
            remoteStreams: new Set()
        };

        sessions.set(normalized, session);
        setState(normalized, {
            status: 'starting',
            message: 'SSH connection is starting...'
        });

        return await new Promise((resolve) => {
            let finished = false;

            const finish = (result) => {
                if (finished) return;
                finished = true;
                resolve(result);
            };

            const fail = async (err) => {
                const message = err && err.message ? err.message : String(err || 'Unknown error');

                destroySessionTraffic(session);
                await closeSocket(session.server);
                try {
                    conn.end();
                } catch (_) {}

                sessions.delete(normalized);

                setState(normalized, {
                    status: 'error',
                    message,
                    lastError: message,
                    stoppedAt: Date.now()
                });

                finish({
                    success: false,
                    message,
                    state: getState(normalized)
                });
            };

            conn.once('ready', () => {
                if (direction === 'remote_to_local') {
                    conn.on('tcp connection', (details, accept, reject) => {
                        let stream = null;
                        try {
                            stream = accept();
                        } catch (_) {
                            stream = null;
                        }

                        if (!stream) {
                            try {
                                if (typeof reject === 'function') reject();
                            } catch (_) {}
                            return;
                        }

                        const localSocket = net.createConnection({
                            host: localHost,
                            port: localPort
                        });

                        session.remoteStreams.add(stream);
                        session.localSockets.add(localSocket);

                        localSocket.once('connect', () => {
                            localSocket.pipe(stream).pipe(localSocket);
                        });

                        localSocket.on('close', () => {
                            session.localSockets.delete(localSocket);
                        });

                        stream.on('close', () => {
                            session.remoteStreams.delete(stream);
                        });

                        localSocket.on('error', () => {
                            try {
                                stream.end();
                            } catch (_) {}

                            setState(normalized, {
                                status: 'error',
                                message: `Local target ${localHost}:${localPort} is unreachable.`,
                                lastError: `Local target ${localHost}:${localPort} is unreachable.`
                            });
                        });

                        stream.on('error', () => {
                            try {
                                localSocket.destroy();
                            } catch (_) {}
                        });
                    });

                    const tryForwardIn = (bindHost, fallbackUsed = false) => {
                        conn.forwardIn(bindHost, remotePort, (err) => {
                            if (err) {
                                if (!fallbackUsed && bindHost === '0.0.0.0') {
                                    tryForwardIn('127.0.0.1', true);
                                    return;
                                }

                                const baseMessage = err && err.message ? err.message : String(err || 'Unknown error');
                                const extra = bindHost === '0.0.0.0'
                                    ? ' If you need public bind, enable GatewayPorts in sshd_config.'
                                    : '';
                                fail(new Error(`${baseMessage}${extra}`));
                                return;
                            }

                            session.remoteBind = {
                                host: bindHost,
                                port: remotePort
                            };

                            const note = fallbackUsed
                                ? ' (0.0.0.0 rejected by SSH server, fell back to 127.0.0.1)'
                                : '';

                            setState(normalized, {
                                status: 'active',
                                message: `Remote listening on ${bindHost}:${remotePort} -> ${localHost}:${localPort}${note}`,
                                startedAt: Date.now()
                            });

                            finish({
                                success: true,
                                message: 'Forward started.',
                                state: getState(normalized)
                            });
                        });
                    };

                    tryForwardIn(remoteHost, false);

                    return;
                }

                const server = net.createServer((localSocket) => {
                    conn.forwardOut(
                        localSocket.remoteAddress || '127.0.0.1',
                        localSocket.remotePort || 0,
                        remoteHost,
                        remotePort,
                        (err, stream) => {
                            if (err) {
                                localSocket.destroy();
                                setState(normalized, {
                                    status: 'error',
                                    message: `Forward channel failed: ${err.message}`,
                                    lastError: err.message
                                });
                                return;
                            }

                            session.remoteStreams.add(stream);
                            localSocket.pipe(stream).pipe(localSocket);

                            localSocket.on('close', () => {
                                session.localSockets.delete(localSocket);
                            });

                            stream.on('close', () => {
                                session.remoteStreams.delete(stream);
                            });

                            localSocket.on('error', () => {
                                try {
                                    stream.end();
                                } catch (_) {}
                            });

                            stream.on('error', () => {
                                try {
                                    localSocket.destroy();
                                } catch (_) {}
                            });
                        }
                    );
                });

                session.server = server;

                server.on('connection', (localSocket) => {
                    session.localSockets.add(localSocket);
                    localSocket.on('close', () => {
                        session.localSockets.delete(localSocket);
                    });
                });

                server.on('error', (err) => {
                    fail(err);
                });

                server.listen(localPort, localHost, () => {
                    setState(normalized, {
                        status: 'active',
                        message: `Listening on ${localHost}:${localPort} -> ${remoteHost}:${remotePort}`,
                        startedAt: Date.now()
                    });

                    finish({
                        success: true,
                        message: 'Forward started.',
                        state: getState(normalized)
                    });
                });
            });

            conn.on('error', (err) => {
                fail(err);
            });

            conn.on('close', async () => {
                const activeSession = sessions.get(normalized);
                if (!activeSession) return;

                destroySessionTraffic(activeSession);
                await closeSocket(activeSession.server);
                sessions.delete(normalized);

                const current = getState(normalized);
                if (current.status === 'active' || current.status === 'starting') {
                    setState(normalized, {
                        status: 'stopped',
                        message: 'SSH connection closed.',
                        stoppedAt: Date.now()
                    });
                }
            });

            try {
                conn.connect(buildConnectConfig(host, normalized));
            } catch (err) {
                fail(err);
            }
        });
    } catch (err) {
        return {
            success: false,
            message: err && err.message ? err.message : String(err)
        };
    }
}

async function stopForward(forwardId) {
    const normalized = normalizeId(forwardId);
    const session = sessions.get(normalized);

    if (!session) {
        setState(normalized, {
            status: 'stopped',
            message: 'Forward is not running.',
            stoppedAt: Date.now()
        });
        return {
            success: true,
            message: 'Forward already stopped.',
            state: getState(normalized)
        };
    }

    destroySessionTraffic(session);
    await closeSocket(session.server);

    if (session.direction === 'remote_to_local' && session.remoteBind) {
        await new Promise((resolve) => {
            try {
                session.conn.unforwardIn(session.remoteBind.host, session.remoteBind.port, () => resolve());
            } catch (_) {
                resolve();
            }
        });
    }

    try {
        session.conn.end();
    } catch (_) {}

    sessions.delete(normalized);

    setState(normalized, {
        status: 'stopped',
        message: 'Forward stopped.',
        stoppedAt: Date.now()
    });

    return {
        success: true,
        message: 'Forward stopped.',
        state: getState(normalized)
    };
}

async function stopAllForwards() {
    const ids = Array.from(sessions.keys());
    for (const id of ids) {
        await stopForward(id);
    }
}

async function deleteForward(forwardId) {
    const normalized = normalizeId(forwardId);
    await stopForward(normalized);
    forwards.delete(normalized);
    clearState(normalized);
    return { success: true };
}

module.exports = {
    listForwards,
    saveForward,
    hasPortConflict,
    deleteForward,
    startForward,
    stopForward,
    stopAllForwards,
    getForwardState: getState,
    clearForwardState: clearState
};
