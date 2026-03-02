const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('ssh2');
const db = require('../profile-db');
const { decrypt } = require('../crypto');
const sessions = new Map();

function normalizeId(value) {
    return String(value);
}

function getArray(key) {
    const value = db.get(key);
    return Array.isArray(value) ? value : [];
}

function mapHost(host) {
    return {
        id: host.id,
        name: host.name || host.address || 'Unnamed',
        address: host.address || '',
        username: host.username || 'root',
        icon: host.icon || 'fa-solid fa-server',
        color: host.color || '#89b4fa'
    };
}

function parsePort(value, fallback = 22) {
    const parsed = Number(value || fallback);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        throw new Error('SSH port must be between 1 and 65535.');
    }
    return parsed;
}

function normalizeSide(value) {
    const side = String(value || '').toLowerCase();
    if (side !== 'local' && side !== 'remote') {
        throw new Error('Invalid side. Use "local" or "remote".');
    }
    return side;
}

function isNoSuchFileError(err) {
    if (!err) return false;
    if (err.code === 'ENOENT') return true;
    if (Number(err.code) === 2 || Number(err.errno) === 2) return true;
    const message = String(err.message || '').toLowerCase();
    return message.includes('no such file');
}

function sanitizeEntryName(rawValue) {
    const value = String(rawValue || '').trim();

    if (!value) {
        throw new Error('Name is required.');
    }

    if (value === '.' || value === '..') {
        throw new Error('Invalid name.');
    }

    if (value.includes('/') || value.includes('\\')) {
        throw new Error('Name cannot include path separator.');
    }

    if (value.includes('\0')) {
        throw new Error('Name contains invalid characters.');
    }

    if (process.platform === 'win32') {
        if (/[<>:"|?*]/.test(value)) {
            throw new Error('Name contains invalid Windows characters.');
        }
        if (/[. ]$/.test(value)) {
            throw new Error('Name cannot end with dot or space on Windows.');
        }
    }

    return value;
}

function trimTrailingSeparator(value, separator) {
    if (!value) return value;
    const sep = separator || path.sep;
    const normalized = String(value);
    const parsed = sep === '/'
        ? path.posix.parse(normalized)
        : path.parse(normalized);
    if (normalized === parsed.root) return parsed.root;
    return normalized.replace(new RegExp(`[${sep === '\\' ? '\\\\' : sep}]+$`), '');
}

function getDefaultLocalRoot() {
    if (process.platform === 'win32') {
        const driveCandidates = ['C:\\', 'D:\\', 'E:\\', 'F:\\'];
        for (const drive of driveCandidates) {
            if (fs.existsSync(drive)) return drive;
        }
    }
    return path.parse(process.cwd()).root || '/';
}

function normalizeLocalPath(inputPath) {
    let target = String(inputPath || '').trim();
    if (!target) {
        target = getDefaultLocalRoot();
    }

    if (/^[a-zA-Z]:$/.test(target)) {
        target += '\\';
    }

    let resolved = path.resolve(target);
    if (/^[a-zA-Z]:$/.test(resolved)) {
        resolved += '\\';
    }

    return resolved;
}

function normalizeRemotePath(inputPath, fallback = '/') {
    let target = String(inputPath || '').trim();
    if (!target) target = fallback || '/';

    target = target.replace(/\\/g, '/');
    if (!target.startsWith('/')) target = `/${target}`;

    let normalized = path.posix.normalize(target);
    if (!normalized.startsWith('/')) normalized = `/${normalized}`;

    return normalized || '/';
}

function localParentPath(targetPath) {
    const normalized = normalizeLocalPath(targetPath);
    const parsed = path.parse(normalized);
    if (normalized === parsed.root) return null;
    const parent = path.dirname(normalized);
    if (!parent || parent === normalized) return null;
    return parent;
}

function remoteParentPath(targetPath) {
    const normalized = normalizeRemotePath(targetPath, '/');
    if (normalized === '/') return null;
    const parent = path.posix.dirname(normalized);
    return parent || '/';
}

function sortEntries(entries) {
    return entries.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' });
    });
}

function attrsIsDirectory(attrs, longname = '') {
    if (!attrs) return false;
    if (typeof attrs.isDirectory === 'function') {
        return attrs.isDirectory();
    }
    if (typeof attrs.mode === 'number') {
        return (attrs.mode & 0o170000) === 0o040000;
    }
    if (typeof longname === 'string') {
        return longname.startsWith('d');
    }
    return false;
}

function getHostById(hostId) {
    const normalized = normalizeId(hostId);
    const hosts = getArray('hosts');
    const host = hosts.find((item) => normalizeId(item.id) === normalized);
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

function verifyAndPersistHost(host, hashedKey) {
    const key = Buffer.isBuffer(hashedKey)
        ? hashedKey.toString('hex')
        : String(hashedKey || '');

    let knownHosts = getArray('knownHosts');
    const port = parsePort(host.port || 22, 22);

    const match = knownHosts.find((item) => {
        return item.address === host.address && Number(item.port) === port;
    });

    if (match) {
        return match.key === key;
    }

    knownHosts.push({
        address: host.address,
        port,
        key,
        firstSeen: Date.now()
    });
    db.set('knownHosts', knownHosts);
    return true;
}

function buildConnectConfig(host) {
    const config = {
        host: String(host.address || '').trim(),
        port: parsePort(host.port || 22, 22),
        username: String(host.username || 'root').trim() || 'root',
        readyTimeout: 20000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        hostVerifier: (hashedKey) => verifyAndPersistHost(host, hashedKey)
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
        throw new Error('Selected host has no password or private key.');
    }

    if (!config.host) {
        throw new Error('Selected host has no address.');
    }

    return config;
}

function getSession(sessionId) {
    const normalized = normalizeId(sessionId);
    const session = sessions.get(normalized);
    if (!session) {
        throw new Error('SFTP session not found. Please reconnect.');
    }
    return session;
}

function touchSession(session) {
    if (!session) return;
    session.lastUsedAt = Date.now();
}

function sftpRealpath(sftp, targetPath) {
    return new Promise((resolve) => {
        sftp.realpath(targetPath, (err, out) => {
            if (err || !out) {
                resolve('/');
                return;
            }
            resolve(out);
        });
    });
}

function sftpStat(sftp, targetPath) {
    return new Promise((resolve, reject) => {
        sftp.stat(targetPath, (err, stats) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(stats);
        });
    });
}

function sftpReaddir(sftp, targetPath) {
    return new Promise((resolve, reject) => {
        sftp.readdir(targetPath, (err, list) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(Array.isArray(list) ? list : []);
        });
    });
}

function sftpMkdir(sftp, targetPath) {
    return new Promise((resolve, reject) => {
        sftp.mkdir(targetPath, (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

function sftpRmdir(sftp, targetPath) {
    return new Promise((resolve, reject) => {
        sftp.rmdir(targetPath, (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

function sftpUnlink(sftp, targetPath) {
    return new Promise((resolve, reject) => {
        sftp.unlink(targetPath, (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

function sftpRename(sftp, sourcePath, destinationPath) {
    return new Promise((resolve, reject) => {
        sftp.rename(sourcePath, destinationPath, (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

function sftpReadFileBuffer(sftp, targetPath, maxBytes = null) {
    return new Promise((resolve, reject) => {
        const stream = sftp.createReadStream(targetPath);
        const chunks = [];
        let total = 0;
        let settled = false;

        const finish = (err, buffer = null) => {
            if (settled) return;
            settled = true;
            if (err) {
                reject(err);
                return;
            }
            resolve(buffer || Buffer.alloc(0));
        };

        stream.on('data', (chunk) => {
            const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += data.length;
            if (maxBytes != null && total > Number(maxBytes)) {
                const err = new Error('File is larger than allowed limit.');
                err.code = 'FILE_TOO_LARGE';
                stream.destroy(err);
                return;
            }
            chunks.push(data);
        });

        stream.on('error', (err) => finish(err));
        stream.on('end', () => finish(null, Buffer.concat(chunks)));
    });
}

function sftpWriteTextFile(sftp, targetPath, content) {
    return new Promise((resolve, reject) => {
        const stream = sftp.createWriteStream(targetPath, { flags: 'w' });
        let settled = false;
        let finished = false;
        const timeout = setTimeout(() => {
            const err = new Error('Write operation timed out.');
            err.code = 'WRITE_TIMEOUT';
            try { stream.destroy(err); } catch (_) {}
            finish(err);
        }, 20000);

        const finish = (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (err) {
                reject(err);
                return;
            }
            resolve();
        };

        stream.on('error', (err) => finish(err));
        stream.on('finish', () => {
            finished = true;
            finish();
        });
        stream.on('close', () => {
            if (finished) return;
            finish();
        });

        try {
            stream.end(String(content || ''), 'utf8');
        } catch (err) {
            finish(err);
        }
    });
}

function sftpFastPut(sftp, localPath, remotePath) {
    return new Promise((resolve, reject) => {
        sftp.fastPut(localPath, remotePath, (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

function sftpFastGet(sftp, remotePath, localPath) {
    return new Promise((resolve, reject) => {
        sftp.fastGet(remotePath, localPath, (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
        });
    });
}

async function remoteExists(sftp, targetPath) {
    try {
        await sftpStat(sftp, targetPath);
        return true;
    } catch (err) {
        if (isNoSuchFileError(err)) return false;
        throw err;
    }
}

async function localExists(targetPath) {
    try {
        await fs.promises.access(targetPath, fs.constants.F_OK);
        return true;
    } catch (_) {
        return false;
    }
}

async function ensureRemoteDir(sftp, targetPath) {
    const normalized = normalizeRemotePath(targetPath, '/');
    if (normalized === '/') return;

    const parts = normalized.split('/').filter(Boolean);
    let current = '';

    for (const part of parts) {
        current = `${current}/${part}`;
        try {
            const stats = await sftpStat(sftp, current);
            if (!attrsIsDirectory(stats)) {
                throw new Error(`Remote path is not a directory: ${current}`);
            }
        } catch (err) {
            if (isNoSuchFileError(err)) {
                try {
                    await sftpMkdir(sftp, current);
                } catch (mkdirErr) {
                    if (!isNoSuchFileError(mkdirErr) && !String(mkdirErr.message || '').toLowerCase().includes('failure')) {
                        throw mkdirErr;
                    }

                    const recheck = await sftpStat(sftp, current);
                    if (!attrsIsDirectory(recheck)) {
                        throw mkdirErr;
                    }
                }
                continue;
            }
            throw err;
        }
    }
}

async function removeLocalPath(targetPath) {
    try {
        if (typeof fs.promises.rm === 'function') {
            await fs.promises.rm(targetPath, { recursive: true, force: true });
            return;
        }
    } catch (err) {
        if (!isNoSuchFileError(err)) throw err;
        return;
    }

    let stats = null;
    try {
        stats = await fs.promises.lstat(targetPath);
    } catch (err) {
        if (isNoSuchFileError(err)) return;
        throw err;
    }

    if (stats.isDirectory()) {
        const children = await fs.promises.readdir(targetPath);
        for (const child of children) {
            await removeLocalPath(path.join(targetPath, child));
        }
        await fs.promises.rmdir(targetPath);
    } else {
        await fs.promises.unlink(targetPath);
    }
}

async function removeRemotePath(sftp, targetPath) {
    const normalized = normalizeRemotePath(targetPath, '/');
    let stats = null;

    try {
        stats = await sftpStat(sftp, normalized);
    } catch (err) {
        if (isNoSuchFileError(err)) return;
        throw err;
    }

    if (attrsIsDirectory(stats)) {
        const entries = await sftpReaddir(sftp, normalized);
        for (const entry of entries) {
            const name = entry && entry.filename ? entry.filename : null;
            if (!name || name === '.' || name === '..') continue;
            await removeRemotePath(sftp, path.posix.join(normalized, name));
        }
        await sftpRmdir(sftp, normalized);
        return;
    }

    await sftpUnlink(sftp, normalized);
}

async function copyLocalPath(sourcePath, destinationPath) {
    const stats = await fs.promises.stat(sourcePath);

    if (stats.isDirectory()) {
        await fs.promises.mkdir(destinationPath, { recursive: true });
        const children = await fs.promises.readdir(sourcePath);
        for (const child of children) {
            await copyLocalPath(
                path.join(sourcePath, child),
                path.join(destinationPath, child)
            );
        }
        return;
    }

    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
    await fs.promises.copyFile(sourcePath, destinationPath);
}

async function copyLocalToRemote(sftp, sourcePath, destinationPath) {
    const stats = await fs.promises.stat(sourcePath);

    if (stats.isDirectory()) {
        await ensureRemoteDir(sftp, destinationPath);
        const children = await fs.promises.readdir(sourcePath);
        for (const child of children) {
            await copyLocalToRemote(
                sftp,
                path.join(sourcePath, child),
                path.posix.join(destinationPath, child)
            );
        }
        return;
    }

    await ensureRemoteDir(sftp, path.posix.dirname(destinationPath));
    await sftpFastPut(sftp, sourcePath, destinationPath);
}

async function copyRemoteToLocal(sftp, sourcePath, destinationPath) {
    const stats = await sftpStat(sftp, sourcePath);

    if (attrsIsDirectory(stats)) {
        await fs.promises.mkdir(destinationPath, { recursive: true });
        const entries = await sftpReaddir(sftp, sourcePath);
        for (const entry of entries) {
            const name = entry && entry.filename ? entry.filename : null;
            if (!name || name === '.' || name === '..') continue;
            await copyRemoteToLocal(
                sftp,
                path.posix.join(sourcePath, name),
                path.join(destinationPath, name)
            );
        }
        return;
    }

    await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
    await sftpFastGet(sftp, sourcePath, destinationPath);
}

function copyRemoteFileViaStream(sftp, sourcePath, destinationPath) {
    return new Promise((resolve, reject) => {
        const readStream = sftp.createReadStream(sourcePath);
        const writeStream = sftp.createWriteStream(destinationPath);
        let settled = false;

        const finish = (err) => {
            if (settled) return;
            settled = true;
            if (err) {
                reject(err);
                return;
            }
            resolve();
        };

        readStream.on('error', (err) => finish(err));
        writeStream.on('error', (err) => finish(err));
        writeStream.on('finish', () => finish());
        readStream.pipe(writeStream);
    });
}

async function copyRemoteToRemote(sftp, sourcePath, destinationPath) {
    const stats = await sftpStat(sftp, sourcePath);

    if (attrsIsDirectory(stats)) {
        await ensureRemoteDir(sftp, destinationPath);
        const entries = await sftpReaddir(sftp, sourcePath);
        for (const entry of entries) {
            const name = entry && entry.filename ? entry.filename : null;
            if (!name || name === '.' || name === '..') continue;
            await copyRemoteToRemote(
                sftp,
                path.posix.join(sourcePath, name),
                path.posix.join(destinationPath, name)
            );
        }
        return;
    }

    await ensureRemoteDir(sftp, path.posix.dirname(destinationPath));
    await copyRemoteFileViaStream(sftp, sourcePath, destinationPath);
}

function copyName(baseName, copyIndex, extensionForFile = '') {
    if (copyIndex === 0) return `${baseName}${extensionForFile}`;
    if (copyIndex === 1) return `${baseName} (copy)${extensionForFile}`;
    return `${baseName} (copy ${copyIndex})${extensionForFile}`;
}

async function resolveUniqueLocalTarget(directoryPath, sourceName, isDirectory) {
    const ext = isDirectory ? '' : path.extname(sourceName);
    const stem = isDirectory ? sourceName : sourceName.slice(0, Math.max(0, sourceName.length - ext.length));

    let copyIndex = 0;
    while (copyIndex < 1000) {
        const candidateName = copyName(stem, copyIndex, ext);
        const candidatePath = path.join(directoryPath, candidateName);
        if (!(await localExists(candidatePath))) {
            return candidatePath;
        }
        copyIndex += 1;
    }

    throw new Error(`Cannot find free target name for ${sourceName}.`);
}

async function resolveUniqueRemoteTarget(sftp, directoryPath, sourceName, isDirectory) {
    const ext = isDirectory ? '' : path.posix.extname(sourceName);
    const stem = isDirectory ? sourceName : sourceName.slice(0, Math.max(0, sourceName.length - ext.length));

    let copyIndex = 0;
    while (copyIndex < 1000) {
        const candidateName = copyName(stem, copyIndex, ext);
        const candidatePath = path.posix.join(directoryPath, candidateName);
        if (!(await remoteExists(sftp, candidatePath))) {
            return candidatePath;
        }
        copyIndex += 1;
    }

    throw new Error(`Cannot find free remote target name for ${sourceName}.`);
}

function isLocalRoot(targetPath) {
    const normalized = normalizeLocalPath(targetPath);
    const parsed = path.parse(normalized);
    const clean = trimTrailingSeparator(normalized, path.sep);
    const root = trimTrailingSeparator(parsed.root, path.sep);
    return clean === root;
}

function isRemoteRoot(targetPath) {
    return normalizeRemotePath(targetPath, '/') === '/';
}

function isNestedLocalPath(parentPath, childPath) {
    const parent = `${trimTrailingSeparator(path.resolve(parentPath), path.sep)}${path.sep}`;
    const child = `${trimTrailingSeparator(path.resolve(childPath), path.sep)}${path.sep}`;
    return child.startsWith(parent);
}

function isNestedRemotePath(parentPath, childPath) {
    const parent = `${trimTrailingSeparator(normalizeRemotePath(parentPath, '/'), '/').replace(/\/+$/, '')}/`;
    const child = `${trimTrailingSeparator(normalizeRemotePath(childPath, '/'), '/').replace(/\/+$/, '')}/`;
    return child.startsWith(parent);
}

async function connect(hostId) {
    try {
        const host = getHostById(hostId);
        if (!host) {
            return { success: false, message: 'Selected VDS host was not found.' };
        }

        const protocol = String(host.protocol || 'SSH').toUpperCase();
        if (protocol !== 'SSH') {
            return { success: false, message: 'Only SSH hosts can be used for SFTP.' };
        }

        const conn = new Client();
        const sessionId = normalizeId(Date.now() + Math.floor(Math.random() * 1000));

        return await new Promise((resolve) => {
            let settled = false;

            const finish = (result) => {
                if (settled) return;
                settled = true;
                resolve(result);
            };

            conn.once('ready', () => {
                conn.sftp(async (err, sftp) => {
                    if (err) {
                        try {
                            conn.end();
                        } catch (_) {}
                        finish({
                            success: false,
                            message: err && err.message ? err.message : 'Failed to initialize SFTP subsystem.'
                        });
                        return;
                    }

                    const homePathRaw = await sftpRealpath(sftp, '.');
                    const homePath = normalizeRemotePath(homePathRaw, '/');

                    const session = {
                        id: sessionId,
                        hostId: normalizeId(host.id),
                        conn,
                        sftp,
                        homePath,
                        createdAt: Date.now(),
                        lastUsedAt: Date.now()
                    };

                    sessions.set(sessionId, session);

                    conn.on('close', () => {
                        sessions.delete(sessionId);
                    });

                    finish({
                        success: true,
                        sessionId,
                        homePath,
                        host: mapHost(host)
                    });
                });
            });

            conn.once('error', (err) => {
                finish({
                    success: false,
                    message: err && err.message ? err.message : 'SSH connection failed.'
                });
            });

            conn.once('close', () => {
                if (!sessions.has(sessionId)) return;
                sessions.delete(sessionId);
                finish({
                    success: false,
                    message: 'SSH connection closed.'
                });
            });

            try {
                conn.connect(buildConnectConfig(host));
            } catch (err) {
                finish({
                    success: false,
                    message: err && err.message ? err.message : String(err)
                });
            }
        });
    } catch (err) {
        return {
            success: false,
            message: err && err.message ? err.message : String(err)
        };
    }
}

async function disconnect(sessionId) {
    const normalized = normalizeId(sessionId || '');
    if (!normalized) {
        return { success: false, message: 'Session id is required.' };
    }

    const session = sessions.get(normalized);
    if (!session) {
        return { success: true, message: 'Session already closed.' };
    }

    sessions.delete(normalized);

    return await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            resolve({ success: true, message: 'Session closed.' });
        };

        try {
            session.conn.once('close', finish);
            session.conn.end();
        } catch (_) {
            finish();
        }

        setTimeout(finish, 1500);
    });
}

async function disconnectAll() {
    const ids = Array.from(sessions.keys());
    for (const id of ids) {
        await disconnect(id);
    }
}

async function listLocalDirectory(targetPath) {
    const currentPath = normalizeLocalPath(targetPath);
    const stats = await fs.promises.stat(currentPath);
    if (!stats.isDirectory()) {
        throw new Error('Selected local path is not a folder.');
    }

    const dirents = await fs.promises.readdir(currentPath, { withFileTypes: true });
    const entries = await Promise.all(dirents.map(async (dirent) => {
        const fullPath = path.join(currentPath, dirent.name);
        let entryStats = null;
        try {
            entryStats = await fs.promises.stat(fullPath);
        } catch (_) {
            entryStats = null;
        }

        const isDirectory = entryStats ? entryStats.isDirectory() : dirent.isDirectory();

        return {
            name: dirent.name,
            path: fullPath,
            isDirectory,
            size: isDirectory ? null : (entryStats ? Number(entryStats.size) : null),
            modifiedAt: entryStats ? Number(entryStats.mtimeMs || 0) : null
        };
    }));

    return {
        side: 'local',
        path: currentPath,
        rootPath: path.parse(currentPath).root || getDefaultLocalRoot(),
        parentPath: localParentPath(currentPath),
        entries: sortEntries(entries)
    };
}

async function listRemoteDirectory(sessionId, targetPath) {
    const session = getSession(sessionId);
    touchSession(session);

    const currentPath = normalizeRemotePath(targetPath, session.homePath || '/');
    const stats = await sftpStat(session.sftp, currentPath);
    if (!attrsIsDirectory(stats)) {
        throw new Error('Selected remote path is not a folder.');
    }

    const list = await sftpReaddir(session.sftp, currentPath);
    const entries = list
        .filter((item) => item && item.filename && item.filename !== '.' && item.filename !== '..')
        .map((item) => {
            const attrs = item.attrs || {};
            const isDirectory = attrsIsDirectory(attrs, item.longname || '');
            const itemPath = path.posix.join(currentPath, item.filename);
            const modifiedAt = Number.isFinite(Number(attrs.mtime))
                ? Number(attrs.mtime) * 1000
                : null;

            return {
                name: item.filename,
                path: itemPath,
                isDirectory,
                size: isDirectory ? null : (Number.isFinite(Number(attrs.size)) ? Number(attrs.size) : null),
                modifiedAt
            };
        });

    return {
        side: 'remote',
        path: currentPath,
        rootPath: '/',
        parentPath: remoteParentPath(currentPath),
        homePath: session.homePath || '/',
        entries: sortEntries(entries)
    };
}

async function listDirectory(payload = {}) {
    try {
        const side = normalizeSide(payload.side || 'local');
        if (side === 'local') {
            const data = await listLocalDirectory(payload.path);
            return { success: true, ...data };
        }

        const data = await listRemoteDirectory(payload.sessionId, payload.path);
        return { success: true, ...data };
    } catch (err) {
        return {
            success: false,
            message: err && err.message ? err.message : String(err)
        };
    }
}

async function createDirectory(payload = {}) {
    try {
        const side = normalizeSide(payload.side);
        const name = sanitizeEntryName(payload.name);

        if (side === 'local') {
            const parentPath = normalizeLocalPath(payload.parentPath);
            const parentStats = await fs.promises.stat(parentPath);
            if (!parentStats.isDirectory()) {
                throw new Error('Parent local path must be a folder.');
            }

            const targetPath = path.join(parentPath, name);
            if (await localExists(targetPath)) {
                throw new Error('A file or folder with this name already exists.');
            }

            await fs.promises.mkdir(targetPath);

            return {
                success: true,
                side: 'local',
                path: targetPath
            };
        }

        const session = getSession(payload.sessionId);
        touchSession(session);

        const parentPath = normalizeRemotePath(payload.parentPath, session.homePath || '/');
        const parentStats = await sftpStat(session.sftp, parentPath);
        if (!attrsIsDirectory(parentStats)) {
            throw new Error('Parent remote path must be a folder.');
        }

        const targetPath = normalizeRemotePath(path.posix.join(parentPath, name), '/');
        if (await remoteExists(session.sftp, targetPath)) {
            throw new Error('A file or folder with this name already exists.');
        }

        await sftpMkdir(session.sftp, targetPath);

        return {
            success: true,
            side: 'remote',
            path: targetPath
        };
    } catch (err) {
        return {
            success: false,
            message: err && err.message ? err.message : String(err)
        };
    }
}

async function createFile(payload = {}) {
    try {
        const side = normalizeSide(payload.side);
        const name = sanitizeEntryName(payload.name);
        const content = String(payload.content || '');

        if (side === 'local') {
            const parentPath = normalizeLocalPath(payload.parentPath);
            const parentStats = await fs.promises.stat(parentPath);
            if (!parentStats.isDirectory()) {
                throw new Error('Parent local path must be a folder.');
            }

            const targetPath = path.join(parentPath, name);
            if (await localExists(targetPath)) {
                throw new Error('A file or folder with this name already exists.');
            }

            await fs.promises.writeFile(targetPath, content, { encoding: 'utf8', flag: 'wx' });
            const stats = await fs.promises.stat(targetPath);

            return {
                success: true,
                side: 'local',
                path: targetPath,
                size: Number(stats.size || 0),
                modifiedAt: Number(stats.mtimeMs || 0)
            };
        }

        const session = getSession(payload.sessionId);
        touchSession(session);

        const parentPath = normalizeRemotePath(payload.parentPath, session.homePath || '/');
        const parentStats = await sftpStat(session.sftp, parentPath);
        if (!attrsIsDirectory(parentStats)) {
            throw new Error('Parent remote path must be a folder.');
        }

        const targetPath = normalizeRemotePath(path.posix.join(parentPath, name), '/');
        if (await remoteExists(session.sftp, targetPath)) {
            throw new Error('A file or folder with this name already exists.');
        }

        await sftpWriteTextFile(session.sftp, targetPath, content);
        const stats = await sftpStat(session.sftp, targetPath);

        return {
            success: true,
            side: 'remote',
            path: targetPath,
            size: Number.isFinite(Number(stats.size)) ? Number(stats.size) : null,
            modifiedAt: Number.isFinite(Number(stats.mtime)) ? Number(stats.mtime) * 1000 : null
        };
    } catch (err) {
        return {
            success: false,
            message: err && err.message ? err.message : String(err)
        };
    }
}

async function readFile(payload = {}) {
    try {
        const side = normalizeSide(payload.side);
        const maxBytes = Number.isFinite(Number(payload.maxBytes)) && Number(payload.maxBytes) > 0
            ? Number(payload.maxBytes)
            : null;
        const targetPathInput = String(payload.path || '').trim();
        if (!targetPathInput) {
            return { success: false, message: 'File path is required.' };
        }

        if (side === 'local') {
            const targetPath = normalizeLocalPath(targetPathInput);
            const stats = await fs.promises.stat(targetPath);
            if (stats.isDirectory()) {
                throw new Error('Selected local path is a folder.');
            }

            const size = Number(stats.size || 0);
            if (maxBytes != null && size > maxBytes) {
                return {
                    success: false,
                    tooLarge: true,
                    size,
                    maxBytes,
                    message: 'File is larger than allowed limit.'
                };
            }

            const content = await fs.promises.readFile(targetPath, 'utf8');

            return {
                success: true,
                side: 'local',
                path: targetPath,
                size,
                modifiedAt: Number(stats.mtimeMs || 0),
                content
            };
        }

        const session = getSession(payload.sessionId);
        touchSession(session);

        const targetPath = normalizeRemotePath(targetPathInput, '/');
        const stats = await sftpStat(session.sftp, targetPath);
        if (attrsIsDirectory(stats)) {
            throw new Error('Selected remote path is a folder.');
        }

        const size = Number.isFinite(Number(stats.size)) ? Number(stats.size) : null;
        if (maxBytes != null && size != null && size > maxBytes) {
            return {
                success: false,
                tooLarge: true,
                size,
                maxBytes,
                message: 'File is larger than allowed limit.'
            };
        }

        const contentBuffer = await sftpReadFileBuffer(session.sftp, targetPath, maxBytes);

        return {
            success: true,
            side: 'remote',
            path: targetPath,
            size: size != null ? size : contentBuffer.length,
            modifiedAt: Number.isFinite(Number(stats.mtime)) ? Number(stats.mtime) * 1000 : null,
            content: contentBuffer.toString('utf8')
        };
    } catch (err) {
        if (err && err.code === 'FILE_TOO_LARGE') {
            return {
                success: false,
                tooLarge: true,
                message: 'File is larger than allowed limit.'
            };
        }
        return {
            success: false,
            message: err && err.message ? err.message : String(err)
        };
    }
}

async function writeFile(payload = {}) {
    try {
        const side = normalizeSide(payload.side);
        const content = String(payload.content || '');
        const targetPathInput = String(payload.path || '').trim();
        if (!targetPathInput) {
            return { success: false, message: 'File path is required.' };
        }

        if (side === 'local') {
            const targetPath = normalizeLocalPath(targetPathInput);
            if (isLocalRoot(targetPath)) {
                throw new Error('Root folder cannot be written as a file.');
            }

            let existingStats = null;
            try {
                existingStats = await fs.promises.stat(targetPath);
            } catch (err) {
                if (!isNoSuchFileError(err)) throw err;
                existingStats = null;
            }

            if (existingStats && existingStats.isDirectory()) {
                throw new Error('Selected local path is a folder.');
            }

            if (!existingStats) {
                const parentPath = path.dirname(targetPath);
                const parentStats = await fs.promises.stat(parentPath);
                if (!parentStats.isDirectory()) {
                    throw new Error('Parent local path must be a folder.');
                }
            }

            await fs.promises.writeFile(targetPath, content, 'utf8');
            const updatedStats = await fs.promises.stat(targetPath);

            return {
                success: true,
                side: 'local',
                path: targetPath,
                size: Number(updatedStats.size || 0),
                modifiedAt: Number(updatedStats.mtimeMs || 0)
            };
        }

        const session = getSession(payload.sessionId);
        touchSession(session);

        const targetPath = normalizeRemotePath(targetPathInput, '/');
        if (isRemoteRoot(targetPath)) {
            throw new Error('Remote root cannot be written as a file.');
        }

        let existingStats = null;
        try {
            existingStats = await sftpStat(session.sftp, targetPath);
        } catch (err) {
            if (!isNoSuchFileError(err)) throw err;
            existingStats = null;
        }

        if (existingStats && attrsIsDirectory(existingStats)) {
            throw new Error('Selected remote path is a folder.');
        }

        if (!existingStats) {
            const parentPath = path.posix.dirname(targetPath);
            const parentStats = await sftpStat(session.sftp, parentPath);
            if (!attrsIsDirectory(parentStats)) {
                throw new Error('Parent remote path must be a folder.');
            }
        }

        await sftpWriteTextFile(session.sftp, targetPath, content);
        const updatedStats = await sftpStat(session.sftp, targetPath);

        return {
            success: true,
            side: 'remote',
            path: targetPath,
            size: Number.isFinite(Number(updatedStats.size)) ? Number(updatedStats.size) : null,
            modifiedAt: Number.isFinite(Number(updatedStats.mtime)) ? Number(updatedStats.mtime) * 1000 : null
        };
    } catch (err) {
        return {
            success: false,
            message: err && err.message ? err.message : String(err)
        };
    }
}

async function deleteItems(payload = {}) {
    try {
        const side = normalizeSide(payload.side);
        const rawItems = Array.isArray(payload.items) ? payload.items : [];
        const itemPaths = rawItems
            .map((item) => (item && item.path ? item.path : item))
            .map((value) => String(value || '').trim())
            .filter(Boolean);

        if (!itemPaths.length) {
            return { success: false, message: 'No selected item to delete.' };
        }

        if (side === 'local') {
            for (const target of itemPaths) {
                const normalized = normalizeLocalPath(target);
                if (isLocalRoot(normalized)) {
                    throw new Error('Root folder cannot be deleted.');
                }
                await removeLocalPath(normalized);
            }
        } else {
            const session = getSession(payload.sessionId);
            touchSession(session);
            for (const target of itemPaths) {
                const normalized = normalizeRemotePath(target, '/');
                if (isRemoteRoot(normalized)) {
                    throw new Error('Remote root folder cannot be deleted.');
                }
                await removeRemotePath(session.sftp, normalized);
            }
        }

        return {
            success: true,
            removedCount: itemPaths.length
        };
    } catch (err) {
        return {
            success: false,
            message: err && err.message ? err.message : String(err)
        };
    }
}

async function renameItem(payload = {}) {
    try {
        const side = normalizeSide(payload.side);
        const sourcePathInput = String(payload.path || '').trim();
        const newName = sanitizeEntryName(payload.newName);

        if (!sourcePathInput) {
            return { success: false, message: 'Item path is required.' };
        }

        if (side === 'local') {
            const sourcePath = normalizeLocalPath(sourcePathInput);
            if (isLocalRoot(sourcePath)) {
                throw new Error('Root folder cannot be renamed.');
            }

            const destinationPath = path.join(path.dirname(sourcePath), newName);
            const isExactSamePath = sourcePath === destinationPath;
            const isCaseOnlyLocalRename = process.platform === 'win32'
                && sourcePath.toLowerCase() === destinationPath.toLowerCase()
                && !isExactSamePath;

            if (isExactSamePath) {
                return {
                    success: true,
                    renamed: false,
                    oldPath: sourcePath,
                    newPath: sourcePath
                };
            }

            if (!isCaseOnlyLocalRename && await localExists(destinationPath)) {
                throw new Error('A file or folder with this name already exists.');
            }

            await fs.promises.rename(sourcePath, destinationPath);

            return {
                success: true,
                renamed: true,
                oldPath: sourcePath,
                newPath: destinationPath
            };
        }

        const session = getSession(payload.sessionId);
        touchSession(session);

        const sourcePath = normalizeRemotePath(sourcePathInput, '/');
        if (isRemoteRoot(sourcePath)) {
            throw new Error('Remote root folder cannot be renamed.');
        }

        const destinationPath = normalizeRemotePath(
            path.posix.join(path.posix.dirname(sourcePath), newName),
            '/'
        );

        if (sourcePath === destinationPath) {
            return {
                success: true,
                renamed: false,
                oldPath: sourcePath,
                newPath: sourcePath
            };
        }

        if (await remoteExists(session.sftp, destinationPath)) {
            throw new Error('A file or folder with this name already exists.');
        }

        await sftpRename(session.sftp, sourcePath, destinationPath);

        return {
            success: true,
            renamed: true,
            oldPath: sourcePath,
            newPath: destinationPath
        };
    } catch (err) {
        return {
            success: false,
            message: err && err.message ? err.message : String(err)
        };
    }
}

async function copyItems(payload = {}) {
    try {
        const sourceSide = normalizeSide(payload.sourceSide);
        const destinationSide = normalizeSide(payload.destinationSide);
        const rawItems = Array.isArray(payload.items) ? payload.items : [];
        if (!rawItems.length) {
            return { success: false, message: 'No selected item to copy.' };
        }

        const normalizedItems = rawItems
            .map((item) => {
                if (!item || !item.path) return null;
                const itemPath = String(item.path).trim();
                if (!itemPath) return null;

                return {
                    path: sourceSide === 'local'
                        ? normalizeLocalPath(itemPath)
                        : normalizeRemotePath(itemPath, '/'),
                    isDirectory: Boolean(item.isDirectory)
                };
            })
            .filter(Boolean);

        if (!normalizedItems.length) {
            return { success: false, message: 'No valid item to copy.' };
        }

        const destinationPath = destinationSide === 'local'
            ? normalizeLocalPath(payload.destinationPath)
            : normalizeRemotePath(payload.destinationPath, '/');

        const fallbackSessionId = payload.sessionId != null
            ? normalizeId(payload.sessionId)
            : null;
        const sourceSessionId = payload.sourceSessionId != null
            ? normalizeId(payload.sourceSessionId)
            : fallbackSessionId;
        const destinationSessionId = payload.destinationSessionId != null
            ? normalizeId(payload.destinationSessionId)
            : fallbackSessionId;

        let sourceSession = null;
        if (sourceSide === 'remote') {
            if (!sourceSessionId) {
                throw new Error('Source remote session is required.');
            }
            sourceSession = getSession(sourceSessionId);
            touchSession(sourceSession);
        }

        let destinationSession = null;
        if (destinationSide === 'remote') {
            const selectedDestinationSessionId = destinationSessionId || sourceSessionId;
            if (!selectedDestinationSessionId) {
                throw new Error('Destination remote session is required.');
            }
            destinationSession = getSession(selectedDestinationSessionId);
            touchSession(destinationSession);
        }

        if (destinationSide === 'local') {
            const targetStats = await fs.promises.stat(destinationPath);
            if (!targetStats.isDirectory()) {
                throw new Error('Destination local path must be a folder.');
            }
        } else {
            await ensureRemoteDir(destinationSession.sftp, destinationPath);
            const targetStats = await sftpStat(destinationSession.sftp, destinationPath);
            if (!attrsIsDirectory(targetStats)) {
                throw new Error('Destination remote path must be a folder.');
            }
        }

        const isRemoteToRemote = sourceSide === 'remote' && destinationSide === 'remote';
        const isCrossSessionRemoteCopy = isRemoteToRemote
            && sourceSession
            && destinationSession
            && sourceSession.id !== destinationSession.id;

        let crossSessionTempRoot = null;
        if (isCrossSessionRemoteCopy) {
            crossSessionTempRoot = await fs.promises.mkdtemp(
                path.join(os.tmpdir(), 'termix-sftp-bridge-')
            );
        }

        let copiedCount = 0;

        try {
            for (const item of normalizedItems) {
                const sourcePath = item.path;
                const name = sourceSide === 'local'
                    ? path.basename(sourcePath)
                    : path.posix.basename(sourcePath);

                if (!name) continue;

                let resolvedIsDirectory = item.isDirectory;
                if (sourceSide === 'local') {
                    const sourceStats = await fs.promises.stat(sourcePath);
                    resolvedIsDirectory = sourceStats.isDirectory();
                } else {
                    const sourceStats = await sftpStat(sourceSession.sftp, sourcePath);
                    resolvedIsDirectory = attrsIsDirectory(sourceStats);
                }

                let targetPath = null;
                if (destinationSide === 'local') {
                    targetPath = await resolveUniqueLocalTarget(destinationPath, name, resolvedIsDirectory);
                } else {
                    targetPath = await resolveUniqueRemoteTarget(destinationSession.sftp, destinationPath, name, resolvedIsDirectory);
                }

                if (sourceSide === 'local' && destinationSide === 'local') {
                    if (resolvedIsDirectory && isNestedLocalPath(sourcePath, targetPath)) {
                        throw new Error(`Cannot copy folder into itself: ${sourcePath}`);
                    }
                    await copyLocalPath(sourcePath, targetPath);
                } else if (sourceSide === 'local' && destinationSide === 'remote') {
                    await copyLocalToRemote(destinationSession.sftp, sourcePath, targetPath);
                } else if (sourceSide === 'remote' && destinationSide === 'local') {
                    await copyRemoteToLocal(sourceSession.sftp, sourcePath, targetPath);
                } else {
                    if (resolvedIsDirectory && isNestedRemotePath(sourcePath, targetPath) && !isCrossSessionRemoteCopy) {
                        throw new Error(`Cannot copy folder into itself: ${sourcePath}`);
                    }

                    if (isCrossSessionRemoteCopy) {
                        const bridgePath = path.join(crossSessionTempRoot, name);
                        if (await localExists(bridgePath)) {
                            await removeLocalPath(bridgePath);
                        }
                        await copyRemoteToLocal(sourceSession.sftp, sourcePath, bridgePath);
                        await copyLocalToRemote(destinationSession.sftp, bridgePath, targetPath);
                        await removeLocalPath(bridgePath);
                    } else {
                        await copyRemoteToRemote(destinationSession.sftp, sourcePath, targetPath);
                    }
                }

                copiedCount += 1;
            }
        } finally {
            if (crossSessionTempRoot) {
                await removeLocalPath(crossSessionTempRoot);
            }
        }

        return {
            success: true,
            copiedCount
        };
    } catch (err) {
        return {
            success: false,
            message: err && err.message ? err.message : String(err)
        };
    }
}

module.exports = {
    connect,
    disconnect,
    disconnectAll,
    listDirectory,
    createDirectory,
    createFile,
    readFile,
    writeFile,
    deleteItems,
    renameItem,
    copyItems,
    getDefaultLocalRoot
};
