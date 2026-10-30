'use strict';
// Loaded by the packaged root bootstrap.js; no Electron or native SSH shim.
const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const { FramedTransport } = require('./transport');
const { createRegistry, CAPABILITIES } = require('./registry');

function createSession(socket) {
    const peer = new FramedTransport(socket);
    const emit = (channel, payload) => {
        try { peer.send({ type: 'event', channel, payload }); } catch (_) { peer.close(); }
    };
    const registry = createRegistry(emit);
    const requests = new Set();
    peer.on('message', async (message) => {
        if (message.type === 'send') {
            try { registry.send(message.channel, message.payload); }
            catch (err) { emit('android:error', { message: err.message, code: err.code || 'INVALID_REQUEST' }); }
            return;
        }
        if (message.type !== 'request' || !['string', 'number'].includes(typeof message.id) || typeof message.channel !== 'string') { peer.close(); return; }
        if (requests.has(message.id) || requests.size >= 128) { peer.close(); return; }
        requests.add(message.id);
        try {
            const result = await registry.invoke(message.channel, message.args);
            peer.send({ type: 'response', id: message.id, result: result === undefined ? null : result });
        } catch (err) {
            try { peer.send({ type: 'response', id: message.id, error: { message: err.message || 'Backend request failed.', code: err.code || 'BACKEND_ERROR' } }); }
            catch (_) { peer.close(); }
        } finally { requests.delete(message.id); }
    });
    peer.send({ type: 'ready', protocol: 1, capabilities: CAPABILITIES });
    return { peer, registry };
}

async function startBackend() {
    if (process.env.TERMIX_PLATFORM !== 'android') throw new Error('Set TERMIX_PLATFORM=android before starting this backend.');
    const root = process.env.TERMIX_DATA_ROOT;
    const socketPath = process.env.TERMIX_ANDROID_SOCKET;
    if (!root || !path.isAbsolute(root)) throw new Error('An absolute private TERMIX_DATA_ROOT is required.');
    if (!socketPath || !path.isAbsolute(socketPath)) throw new Error('An absolute private TERMIX_ANDROID_SOCKET is required.');
    // Validate key material before touching the profile filesystem.
    const material = process.env.TERMIX_PORTABLE_KEY || '';
    if (!/^[A-Za-z0-9+/]{64}$/.test(material) || Buffer.from(material, 'base64').length !== 48) throw new Error('A 48-byte Keystore-protected TERMIX_PORTABLE_KEY is required.');
    // Must be provided by a Node runtime with crypto/fs/ssh2 available.
    crypto.randomBytes(1);
    require('ssh2');
    process.umask(0o077);
    fs.mkdirSync(root, { recursive: true, mode: 0o700 });
    fs.chmodSync(root, 0o700);
    process.env.HOME = path.join(root, 'local');
    fs.mkdirSync(process.env.HOME, { recursive: true, mode: 0o700 });
    process.env.TMPDIR = path.join(root, 'tmp');
    fs.mkdirSync(process.env.TMPDIR, { recursive: true, mode: 0o700 });
    const { FILES_DIR, PROFILES_DIR } = require('../../paths');
    for (const directory of [FILES_DIR, PROFILES_DIR]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    require('../../profile-manager').ensureInitialized();
    fs.mkdirSync(path.dirname(socketPath), { recursive: true, mode: 0o700 });
    // Never unlink an arbitrary supplied regular file or an active peer socket.
    if (fs.existsSync(socketPath)) throw new Error('Android backend socket already exists. Native must remove its stale socket before launch.');
    let activeSession = null;
    let closing = false;
    const server = net.createServer((socket) => {
        if (activeSession || closing) { socket.destroy(); return; }
        const session = createSession(socket);
        activeSession = session;
        session.peer.once('close', () => {
            const oldRegistry = session.registry;
            Promise.resolve(oldRegistry.close()).finally(() => { if (activeSession === session) activeSession = null; });
        });
    });
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(socketPath, () => { server.removeListener('error', reject); resolve(); });
    });
    if (process.platform !== 'win32') fs.chmodSync(socketPath, 0o600);
    const close = async () => {
        if (closing) return;
        closing = true;
        if (activeSession) {
            activeSession.peer.close();
            await activeSession.registry.close();
        }
        await new Promise((resolve) => server.close(resolve));
        try { fs.unlinkSync(socketPath); } catch (err) { if (err.code !== 'ENOENT') throw err; }
    };
    server.on('error', () => { void close(); });
    return { server, close, socketPath };
}

// The asset root wrapper require()s this module, so starting cannot depend on
// require.main === module. Tests opt out explicitly and call startBackend().
if (process.env.TERMIX_ANDROID_NO_AUTOSTART !== '1') {
    startBackend().then((backend) => {
        const stop = () => backend.close().then(() => process.exit(0));
        process.once('SIGTERM', stop);
        process.once('SIGINT', stop);
    }).catch(() => { console.error('Android backend startup failed. Check private runtime configuration and packaged dependencies.'); process.exitCode = 1; });
}
module.exports = { startBackend, createSession };
