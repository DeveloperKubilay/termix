'use strict';
const fs = require('fs');
const path = require('path');
const { FILES_DIR, DATA_ROOT } = require('../../paths');
const db = require('../../profile-db');
const profiles = require('../../profile-manager');
const defaults = require('../../profile-defaults');
const sftp = require('../../sftp/manager');
const { decrypt } = require('../../crypto');
const { safePath } = require('./sandbox');
const { HostTrust } = require('./trust');
const { TerminalSessions } = require('./sessions');

const STAGING_ROOT = path.join(DATA_ROOT, 'local', 'staging');
const CAPABILITIES = Object.freeze({ ssh: true, sftp: true, profiles: true, keychain: true, knownHosts: true, snippets: true, local: false, serial: false, mcp: false, updater: false, cloud: false, ai: false, portForwarding: false });
// Explicit imports only: a channel can never select an arbitrary module/file.
const COMMANDS = Object.freeze({
    'hosts:get-data': require('../../../commands/hosts/get-data'),
    'hosts:set-data': require('../../../commands/hosts/set-data'),
    'hosts:get-tags': require('../../../commands/hosts/get-tags'),
    'hosts:add-tag': require('../../../commands/hosts/add-tag'),
    'hosts:delete-tag': require('../../../commands/hosts/delete-tag'),
    'hosts:update-terminal-font-size': require('../../../commands/hosts/update-terminal-font-size'),
    'known-hosts:get-hosts': require('../../../commands/known-hosts/get-hosts'),
    'known-hosts:delete-host': require('../../../commands/known-hosts/delete-host'),
    'snippets:get-snippets': require('../../../commands/snippets/get-snippets'),
    'snippets:save-snippet': require('../../../commands/snippets/save-snippet'),
    'snippets:delete-snippet': require('../../../commands/snippets/delete-snippet'),
    'sftp:list-directory': require('../../../commands/sftp/list-directory'),
    'sftp:create-directory': require('../../../commands/sftp/create-directory'),
    'sftp:create-file': require('../../../commands/sftp/create-file'),
    'sftp:read-file': require('../../../commands/sftp/read-file'),
    'sftp:write-file': require('../../../commands/sftp/write-file'),
    'sftp:delete-items': require('../../../commands/sftp/delete-items'),
    'sftp:rename-item': require('../../../commands/sftp/rename-item'),
    'sftp:copy-items': require('../../../commands/sftp/copy-items')
});

function unsupported(message = 'This desktop or cloud feature is not supported on Android.') {
    return Object.assign(new Error(message), { code: 'UNSUPPORTED' });
}
function localProfile(id) {
    const record = profiles.getProfiles().profiles.find((item) => item.id === id);
    if (!record) throw new Error('Profile not found.');
    if (record.type !== 'local') throw unsupported('Cloud profiles are not supported on Android.');
    return record;
}
function keyPath(name) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('Key file name is required.');
    const target = safePath(FILES_DIR, name);
    if (target === path.resolve(FILES_DIR)) throw new Error('Key file name is required.');
    return target;
}
function keyFiles() {
    const entries = [];
    const scan = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            if (entry.isSymbolicLink()) continue;
            const file = safePath(FILES_DIR, path.join(directory, entry.name));
            if (entry.isDirectory()) scan(file);
            else if (/\.(pem|key|pub|ppk|cer|crt|pfx)$/i.test(entry.name)) {
                entries.push({ name: entry.name, relativePath: path.relative(FILES_DIR, file), size: (fs.statSync(file).size / 1024).toFixed(2), path: file });
            }
        }
    };
    scan(FILES_DIR);
    return entries;
}

function createRegistry(emit) {
    let closed = false;
    let activeTransfers = 0;
    const notifyServiceState = () => {
        if (!closed) {
            try {
                emit('android:service-state', {
                    terminals: terminals.sessions.size,
                    sftp: sftpControllers.size,
                    transfers: activeTransfers
                });
            } catch (_) {}
        }
    };
    const trust = new HostTrust(emit);
    const terminals = new TerminalSessions(emit, trust, { onCountChange: () => notifyServiceState() });
    const sftpControllers = new Map();
    const event = { sender: { send: (channel, payload) => { if (!closed) emit(channel, payload); }, isDestroyed: () => closed } };
    const disconnectSftp = async (id) => {
        const controller = sftpControllers.get(String(id));
        if (controller) controller.abort();
        sftpControllers.delete(String(id));
        notifyServiceState();
        return sftp.disconnect(id);
    };
    const closeConnections = async () => {
        terminals.close();
        trust.close();
        for (const controller of sftpControllers.values()) controller.abort();
        sftpControllers.clear();
        await sftp.disconnectAll();
        notifyServiceState();
    };
    const handlers = new Map(Object.entries(COMMANDS).map(([channel, command]) => [channel, (...args) => command(FILES_DIR, ...args, event)]));
    handlers.set('android:get-capabilities', () => CAPABILITIES);
    handlers.set('android:trust-host-key', (payload) => trust.approve(payload));
    handlers.set('android:download-stage', async (payload = {}) => {
        if (payload && payload.action === 'cleanup' && payload.stageId) {
            try {
                const target = safePath(STAGING_ROOT, String(payload.stageId));
                if (target !== path.resolve(STAGING_ROOT) && fs.existsSync(target)) {
                    await fs.promises.rm(target, { recursive: true, force: true });
                }
            } catch (_) {}
            return { success: true };
        }
        const stageId = require('crypto').randomUUID();
        const stageDir = safePath(STAGING_ROOT, stageId);
        await fs.promises.mkdir(stageDir, { recursive: true, mode: 0o700 });
        return {
            success: true,
            stageId,
            stageDir,
            stagingRoot: STAGING_ROOT
        };
    });
    handlers.set('profiles:get-profiles', () => profiles.getProfiles());
    handlers.set('profiles:create-profile', async (payload = {}) => {
        if (payload.type && payload.type !== 'local') throw unsupported('Cloud profiles are not supported on Android.');
        // No arbitrary config can turn this into a cloud-backed profile.
        const result = await profiles.createProfile({ name: payload.name, type: 'local', activate: payload.activate !== false });
        return result;
    });
    handlers.set('profiles:switch-profile', async (id) => {
        localProfile(id);
        if (terminals.sessions.size || sftpControllers.size) throw Object.assign(new Error('Close active connections before switching profiles.'), { code: 'CONNECTIONS_ACTIVE' });
        trust.close();
        return profiles.switchProfile(id, { pullFromCloud: false });
    });
    handlers.set('profiles:delete-profile', (id) => {
        localProfile(id);
        if (terminals.sessions.size || sftpControllers.size) throw Object.assign(new Error('Close active connections before deleting profiles.'), { code: 'CONNECTIONS_ACTIVE' });
        return profiles.deleteProfile(id, { pullFromCloud: false });
    });
    handlers.set('settings:get-settings', () => ({
        ai: { method: 'GET', url: '', body: {}, headers: {} },
        sftpSettings: defaults.normalizeSftpSettings(db.get('sftpSettings')),
        uiTheme: defaults.normalizeUiTheme(db.get('uiTheme')),
        profile: { name: db.get('name'), type: 'local' }, tags: db.get('tags') || []
    }));
    handlers.set('settings:save-settings', (settings = {}) => {
        if (settings.ai || settings.updateSettings) throw unsupported('AI and desktop updates are not supported on Android.');
        if (settings.sftpSettings) db.set('sftpSettings', defaults.normalizeSftpSettings(settings.sftpSettings));
        if (settings.uiTheme !== undefined) db.set('uiTheme', defaults.normalizeUiTheme(settings.uiTheme));
        return { success: true };
    });
    handlers.set('connection:get-settings', () => defaults.normalizeTerminalSettings(db.get('terminalSettings')));
    handlers.set('connection:save-settings', (settings) => db.set('terminalSettings', defaults.normalizeTerminalSettings({ ...db.get('terminalSettings'), ...settings })));
    handlers.set('connection:connect', (host, options) => terminals.connect(host, options));
    handlers.set('keychain:get-key-files', keyFiles);
    handlers.set('keychain:read-key-file', async (name) => {
        try { return { success: true, content: await fs.promises.readFile(keyPath(name), 'utf8') }; }
        catch (err) { return { success: false, error: err.message }; }
    });
    handlers.set('keychain:save-key-file', async (oldName, newName, content) => {
        try {
            if (typeof content !== 'string') throw new Error('Key content must be text.');
            const destination = keyPath(newName);
            const source = oldName ? keyPath(oldName) : null;
            await fs.promises.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
            await fs.promises.writeFile(destination, content, { encoding: 'utf8', mode: 0o600 });
            await fs.promises.chmod(destination, 0o600);
            if (source && source !== destination && fs.existsSync(source)) await fs.promises.unlink(source);
            return { success: true };
        } catch (err) { return { success: false, error: err.message }; }
    });
    handlers.set('sftp:connect', async (hostId) => {
        const hosts = db.get('hosts');
        const stored = (Array.isArray(hosts) ? hosts : []).find((host) => String(host.id) === String(hostId));
        if (!stored) return { success: false, message: 'Selected host was not found.' };
        const host = { ...stored, password: stored.password ? decrypt(stored.password) : '' };
        const sessionId = require('crypto').randomUUID();
        const controller = new AbortController();
        sftpControllers.set(sessionId, controller);
        const result = await sftp.connect(hostId, { host, sessionId, signal: controller.signal, hostVerifier: trust.verifier(host, { sessionId, signal: controller.signal }) });
        if (!result.success || closed) {
            controller.abort();
            sftpControllers.delete(sessionId);
            if (result.success) await sftp.disconnect(sessionId);
            notifyServiceState();
            return closed ? { success: false, message: 'Backend transport is closed.' } : result;
        }
        notifyServiceState();
        return result;
    });
    handlers.set('sftp:disconnect', disconnectSftp);
    handlers.set('android:stop-all-connections', async () => {
        await closeConnections();
        return { success: true };
    });
    const baseCopyItems = handlers.get('sftp:copy-items');
    if (baseCopyItems) {
        handlers.set('sftp:copy-items', async (...args) => {
            activeTransfers++;
            notifyServiceState();
            try {
                return await baseCopyItems(...args);
            } finally {
                activeTransfers = Math.max(0, activeTransfers - 1);
                notifyServiceState();
            }
        });
    }
    return {
        capabilities: CAPABILITIES,
        async invoke(channel, args) {
            if (closed) throw new Error('Backend transport is closed.');
            if (!Array.isArray(args)) throw Object.assign(new Error('RPC args must be an array.'), { code: 'INVALID_REQUEST' });
            const handler = handlers.get(channel);
            if (!handler) throw unsupported();
            if (!channel.startsWith('profiles:') && !channel.startsWith('android:')) {
                const active = profiles.getProfiles();
                localProfile(active.activeProfileId);
            }
            return handler(...args);
        },
        send(channel, payload) {
            if (!['term-input', 'term-resize', 'term-close'].includes(channel)) throw unsupported();
            if (!closed) terminals.send(channel, payload);
        },
        async close() { closed = true; await closeConnections(); }
    };
}
module.exports = { createRegistry, CAPABILITIES };
