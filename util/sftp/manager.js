const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('ssh2');
const db = require('../profile-db');
const { decrypt } = require('../crypto');
const { normalizeSftpSettings } = require('../profile-defaults');
const tarTransfer = require('./tar-transfer');
const { createExcludeMatcher } = require('./exclude');
const sessions = new Map();

const SSH_READY_TIMEOUT_MS = 20000;
const SSH_KEEPALIVE_INTERVAL_MS = 10000;
const SSH_KEEPALIVE_COUNT_MAX = 6;
const SFTP_IDLE_PING_INTERVAL_MS = 20000;
const SFTP_IDLE_PING_MIN_IDLE_MS = 15000;
const SFTP_TRANSFER_STALL_TIMEOUT_MS = 30000;
// How many files are transferred at once over a single SFTP channel.
const TRANSFER_CONCURRENCY = 8;
// Above this many files, one tar stream beats per-file SFTP round trips.
const TAR_MIN_FILES = 200;

function createSessionId() {
    if (typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return crypto.randomBytes(16).toString('hex');
}

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

function normalizeConflictPolicy(value) {
    const policy = String(value || '').toLowerCase();
    if (policy === 'overwrite' || policy === 'error') {
        return policy;
    }
    return 'rename';
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
    const home = os.homedir();
    const candidates = [
        path.join(home, 'OneDrive', 'Desktop'),
        path.join(home, 'OneDrive', 'Masaüstü'),
        path.join(home, 'Desktop'),
        path.join(home, 'Masaüstü'),
    ];
    for (const candidate of candidates) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return home;
}

async function findRemoteDesktopPath(sftp, homePath) {
    const candidates = [
        path.posix.join(homePath, 'OneDrive', 'Desktop'),
        path.posix.join(homePath, 'OneDrive', 'Masaüstü'),
        path.posix.join(homePath, 'Desktop'),
        path.posix.join(homePath, 'Masaüstü'),
    ];
    for (const candidate of candidates) {
        try {
            const stats = await sftpStat(sftp, candidate);
            if (attrsIsDirectory(stats)) {
                return candidate;
            }
        } catch (_) {
            // not found, try next
        }
    }
    return null;
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
        readyTimeout: SSH_READY_TIMEOUT_MS,
        keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
        keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
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

function clearSessionKeepalive(session) {
    if (!session || !session.keepaliveTimer) return;
    clearInterval(session.keepaliveTimer);
    session.keepaliveTimer = null;
}

function startSessionKeepalive(session) {
    if (!session) return;
    clearSessionKeepalive(session);
    session.keepaliveTimer = setInterval(() => {
        keepSftpSessionAlive(session.id).catch(() => {});
    }, SFTP_IDLE_PING_INTERVAL_MS);

    if (session.keepaliveTimer && typeof session.keepaliveTimer.unref === 'function') {
        session.keepaliveTimer.unref();
    }
}

async function keepSftpSessionAlive(sessionId) {
    const session = sessions.get(normalizeId(sessionId));
    if (!session || session.isClosing || session.keepaliveInFlight) {
        return;
    }

    const idleForMs = Date.now() - Number(session.lastUsedAt || 0);
    if (idleForMs < SFTP_IDLE_PING_MIN_IDLE_MS) {
        return;
    }

    session.keepaliveInFlight = true;
    try {
        await sftpPing(session.sftp, session.homePath || '.');
        session.lastKeepaliveAt = Date.now();
    } finally {
        session.keepaliveInFlight = false;
    }
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

function sftpPing(sftp, targetPath) {
    return new Promise((resolve, reject) => {
        sftp.realpath(targetPath, (err) => {
            if (err) {
                reject(err);
                return;
            }
            resolve();
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

// A 2 KB file does not need 64 chunks in flight; asking for them wastes buffers
// and crowds the SSH window when several files are transferred at once.
function chunkOptionsForSize(size) {
    const bytes = Number(size || 0);
    if (bytes > 8 * 1024 * 1024) return { concurrency: 64, chunkSize: 32768 * 16 };
    if (bytes > 1024 * 1024) return { concurrency: 16, chunkSize: 32768 * 8 };
    if (bytes > 128 * 1024) return { concurrency: 8, chunkSize: 32768 * 4 };
    return { concurrency: 2, chunkSize: 32768 };
}

function copyLocalFileToRemoteWithProgress(sftp, sourcePath, destinationPath, onChunk, knownSize = null) {
    return new Promise((resolve, reject) => {
        let lastTransferred = 0;
        let settled = false;
        let stallTimer = null;

        const settle = (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(stallTimer);
            if (err) reject(err);
            else resolve();
        };

        const resetStallTimer = () => {
            clearTimeout(stallTimer);
            stallTimer = setTimeout(() => {
                const err = new Error('Upload stalled: no progress for 30 seconds.');
                err.code = 'STALL_TIMEOUT';
                settle(err);
            }, SFTP_TRANSFER_STALL_TIMEOUT_MS);
        };

        resetStallTimer();

        const options = {
            ...chunkOptionsForSize(knownSize),
            step: (totalTransferred) => {
                resetStallTimer();
                const total = Number(totalTransferred);
                if (Number.isFinite(total)) {
                    const delta = Math.max(0, total - lastTransferred);
                    lastTransferred = total;
                    if (delta > 0 && typeof onChunk === 'function') onChunk(delta);
                }
            }
        };

        sftp.fastPut(sourcePath, destinationPath, options, (err) => {
            settle(err || null);
        });
    });
}

function copyRemoteFileToLocalWithProgress(sftp, sourcePath, destinationPath, onChunk, knownSize = null) {
    return new Promise((resolve, reject) => {
        let lastTransferred = 0;
        let settled = false;
        let stallTimer = null;

        const settle = (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(stallTimer);
            if (err) reject(err);
            else resolve();
        };

        const resetStallTimer = () => {
            clearTimeout(stallTimer);
            stallTimer = setTimeout(() => {
                const err = new Error('Download stalled: no progress for 30 seconds.');
                err.code = 'STALL_TIMEOUT';
                settle(err);
            }, SFTP_TRANSFER_STALL_TIMEOUT_MS);
        };

        resetStallTimer();

        const options = {
            ...chunkOptionsForSize(knownSize),
            step: (totalTransferred) => {
                resetStallTimer();
                const total = Number(totalTransferred);
                if (Number.isFinite(total)) {
                    const delta = Math.max(0, total - lastTransferred);
                    lastTransferred = total;
                    if (delta > 0 && typeof onChunk === 'function') onChunk(delta);
                }
            }
        };

        sftp.fastGet(sourcePath, destinationPath, options, (err) => {
            settle(err || null);
        });
    });
}

function createCopyProgressReporter({ operationId, direction, totalBytes, onProgress }) {
    const hasValidOperationId = Boolean(operationId);
    const hasValidDirection = direction === 'upload' || direction === 'download';
    const hasProgressHandler = typeof onProgress === 'function';

    if (!hasValidOperationId || !hasValidDirection || !hasProgressHandler) {
        return null;
    }

    const total = Math.max(0, Number(totalBytes || 0));
    let transferred = 0;
    let lastSentAt = 0;

    const emit = (currentItemName, force) => {
        const now = Date.now();
        if (!force && now - lastSentAt < 80) {
            return;
        }

        lastSentAt = now;
        onProgress({
            operationId,
            direction,
            totalBytes: total,
            transferredBytes: transferred,
            currentItemName,
            percent: force && total === 0
                ? 100
                : (total > 0 ? (transferred / total) * 100 : 0)
        });
    };

    emit('', true);

    return {
        advance(bytes, currentItemName) {
            transferred += Math.max(0, Number(bytes || 0));
            if (total > 0 && transferred > total) {
                transferred = total;
            }
            emit(currentItemName, false);
        },
        complete(currentItemName) {
            if (total > 0) {
                transferred = total;
            }
            emit(currentItemName, true);
        }
    };
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

function localPathsMatch(leftPath, rightPath) {
    const left = normalizeLocalPath(leftPath);
    const right = normalizeLocalPath(rightPath);
    if (process.platform === 'win32') {
        return left.toLowerCase() === right.toLowerCase();
    }
    return left === right;
}

function remotePathsMatch(leftPath, rightPath) {
    return normalizeRemotePath(leftPath, '/') === normalizeRemotePath(rightPath, '/');
}

function buildCopyConflict({ name, sourcePath, targetPath, isDirectory, destinationSide }) {
    return {
        name,
        sourcePath,
        targetPath,
        isDirectory: Boolean(isDirectory),
        destinationSide
    };
}

// `knownDirs` is an optional Set of paths already known to exist. A copy that
// walks thousands of files would otherwise stat every path component again for
// every single file.
async function ensureRemoteDir(sftp, targetPath, knownDirs = null) {
    const normalized = normalizeRemotePath(targetPath, '/');
    if (normalized === '/') return;
    if (knownDirs && knownDirs.has(normalized)) return;

    const parts = normalized.split('/').filter(Boolean);
    let current = '';

    for (const part of parts) {
        current = `${current}/${part}`;
        if (knownDirs && knownDirs.has(current)) continue;
        try {
            const stats = await sftpStat(sftp, current);
            if (!attrsIsDirectory(stats)) {
                throw new Error(`Remote path is not a directory: ${current}`);
            }
            if (knownDirs) knownDirs.add(current);
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
                if (knownDirs) knownDirs.add(current);
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

// Runs `worker` over `items` with a bounded number of transfers in flight. A
// single SFTP channel pipelines requests happily, and waiting for one small
// file at a time is what makes large folders crawl.
async function runWithConcurrency(items, worker, concurrency = TRANSFER_CONCURRENCY) {
    if (!items.length) return;

    let cursor = 0;
    let firstError = null;
    const workerCount = Math.max(1, Math.min(concurrency, items.length));

    const runners = Array.from({ length: workerCount }, async () => {
        while (cursor < items.length && !firstError) {
            const item = items[cursor++];
            try {
                await worker(item);
            } catch (err) {
                if (!firstError) firstError = err;
            }
        }
    });

    await Promise.all(runners);
    if (firstError) throw firstError;
}

// Walks a local tree once and returns everything the copy needs: the
// directories to create, the files to send and the total size for progress.
async function collectLocalTree(sourcePath, exclude = null) {
    const rootStats = await fs.promises.stat(sourcePath);

    if (!rootStats.isDirectory()) {
        const size = Number(rootStats.size || 0);
        return { isDirectory: false, dirs: [], files: [{ relative: '', size }], totalBytes: size, skipped: 0 };
    }

    const dirs = [];
    const files = [];
    let totalBytes = 0;
    let skipped = 0;
    const pending = [''];

    while (pending.length) {
        const relativeDir = pending.pop();
        dirs.push(relativeDir);

        const absoluteDir = relativeDir ? path.join(sourcePath, relativeDir) : sourcePath;
        const entries = await fs.promises.readdir(absoluteDir, { withFileTypes: true });

        for (const entry of entries) {
            const relative = relativeDir ? path.posix.join(relativeDir, entry.name) : entry.name;
            const absolute = path.join(absoluteDir, entry.name);

            if (exclude && exclude(relative, entry.name)) {
                skipped += 1;
                continue;
            }

            let isDirectory = entry.isDirectory();
            let size = 0;

            if (entry.isSymbolicLink()) {
                // Follow links the way the previous implementation did.
                const linkStats = await fs.promises.stat(absolute);
                isDirectory = linkStats.isDirectory();
                size = Number(linkStats.size || 0);
            } else if (!isDirectory) {
                const fileStats = await fs.promises.stat(absolute);
                size = Number(fileStats.size || 0);
            }

            if (isDirectory) {
                pending.push(relative);
            } else {
                files.push({ relative, size });
                totalBytes += size;
            }
        }
    }

    return { isDirectory: true, dirs, files, totalBytes, skipped };
}

// Same walk on the remote side. readdir already carries the attributes, so no
// per-file stat round trip is needed.
async function collectRemoteTree(sftp, sourcePath, exclude = null) {
    const rootStats = await sftpStat(sftp, sourcePath);

    if (!attrsIsDirectory(rootStats)) {
        const size = Number(rootStats.size || 0);
        return { isDirectory: false, dirs: [], files: [{ relative: '', size }], totalBytes: size, skipped: 0 };
    }

    const dirs = [];
    const files = [];
    let totalBytes = 0;
    let skipped = 0;
    const pending = [''];

    while (pending.length) {
        const relativeDir = pending.pop();
        dirs.push(relativeDir);

        const absoluteDir = relativeDir ? path.posix.join(sourcePath, relativeDir) : sourcePath;
        const entries = await sftpReaddir(sftp, absoluteDir);

        for (const entry of entries) {
            const name = entry && entry.filename ? entry.filename : null;
            if (!name || name === '.' || name === '..') continue;

            const relative = relativeDir ? path.posix.join(relativeDir, name) : name;

            if (exclude && exclude(relative, name)) {
                skipped += 1;
                continue;
            }

            let attrs = entry.attrs;

            if (!attrs) {
                attrs = await sftpStat(sftp, path.posix.join(absoluteDir, name));
            }

            if (attrsIsDirectory(attrs)) {
                pending.push(relative);
            } else {
                const size = Number(attrs.size || 0);
                files.push({ relative, size });
                totalBytes += size;
            }
        }
    }

    return { isDirectory: true, dirs, files, totalBytes, skipped };
}

// Creates directories parents first, but in parallel within each depth level.
async function createRemoteDirs(sftp, destinationPath, relativeDirs, knownDirs) {
    const byDepth = new Map();

    for (const relative of relativeDirs) {
        const target = relative ? path.posix.join(destinationPath, relative) : destinationPath;
        const depth = target.split('/').filter(Boolean).length;
        if (!byDepth.has(depth)) byDepth.set(depth, []);
        byDepth.get(depth).push(target);
    }

    for (const depth of Array.from(byDepth.keys()).sort((a, b) => a - b)) {
        await runWithConcurrency(byDepth.get(depth), (target) => ensureRemoteDir(sftp, target, knownDirs));
    }
}

async function createLocalDirs(destinationPath, relativeDirs) {
    for (const relative of relativeDirs.slice().sort((a, b) => a.length - b.length)) {
        const target = relative ? path.join(destinationPath, relative) : destinationPath;
        await fs.promises.mkdir(target, { recursive: true });
    }
}

async function countLocalFiles(targetPath) {
    let total = 0;
    const pending = [targetPath];

    while (pending.length) {
        const dir = pending.pop();
        let entries;
        try {
            entries = await fs.promises.readdir(dir, { withFileTypes: true });
        } catch (_) {
            continue;
        }

        for (const entry of entries) {
            if (entry.isDirectory()) pending.push(path.join(dir, entry.name));
            else total += 1;
        }
    }

    return total;
}

// Probes the host once per session: can it pack and unpack tar archives?
async function sessionSupportsTar(session) {
    if (!session || !session.conn) return false;
    if (typeof session.hasTar === 'boolean') return session.hasTar;

    session.hasTar = await tarTransfer.detectRemoteTar(session.conn);
    return session.hasTar;
}

async function copyLocalToRemote(sftp, sourcePath, destinationPath, progressReporter = null, options = {}) {
    const knownDirs = options.knownDirs || new Set();
    const exclude = options.exclude || null;
    const tree = options.tree || await collectLocalTree(sourcePath, exclude);

    if (!tree.isDirectory) {
        await ensureRemoteDir(sftp, path.posix.dirname(destinationPath), knownDirs);
        await copyLocalFileToRemoteWithProgress(sftp, sourcePath, destinationPath, (bytes) => {
            if (progressReporter) {
                progressReporter.advance(bytes, path.basename(sourcePath));
            }
        }, tree.files[0] ? tree.files[0].size : null);
        return;
    }

    // One tar stream instead of thousands of per-file round trips.
    if (options.session && tree.files.length >= TAR_MIN_FILES && await sessionSupportsTar(options.session)) {
        await ensureRemoteDir(sftp, destinationPath, knownDirs);
        await tarTransfer.uploadDirectory(options.session.conn, sourcePath, destinationPath, {
            onBytes: (bytes) => {
                if (progressReporter) progressReporter.advance(bytes, path.basename(sourcePath));
            },
            filter: exclude
                ? (entryPath) => {
                    const relative = String(entryPath || '').replace(/^\.\//, '');
                    if (!relative || relative === '.') return true;
                    return !exclude(relative, path.posix.basename(relative));
                }
                : null
        });

        // A tar stream either lands whole or the command fails, but the count is
        // cheap and turns a silent partial copy into a visible error.
        const delivered = await tarTransfer.countRemoteFiles(options.session.conn, destinationPath);
        if (delivered != null && delivered < tree.files.length) {
            throw new Error(`Transfer verification failed: ${delivered} of ${tree.files.length} files arrived at ${destinationPath}.`);
        }
        return;
    }

    await createRemoteDirs(sftp, destinationPath, tree.dirs, knownDirs);

    await runWithConcurrency(tree.files, async (file) => {
        const source = path.join(sourcePath, file.relative);
        const target = path.posix.join(destinationPath, file.relative);
        await copyLocalFileToRemoteWithProgress(sftp, source, target, (bytes) => {
            if (progressReporter) {
                progressReporter.advance(bytes, path.basename(source));
            }
        }, file.size);
    });
}

async function copyRemoteToLocal(sftp, sourcePath, destinationPath, progressReporter = null, options = {}) {
    const exclude = options.exclude || null;
    const tree = options.tree || await collectRemoteTree(sftp, sourcePath, exclude);

    if (!tree.isDirectory) {
        await fs.promises.mkdir(path.dirname(destinationPath), { recursive: true });
        await copyRemoteFileToLocalWithProgress(sftp, sourcePath, destinationPath, (bytes) => {
            if (progressReporter) {
                progressReporter.advance(bytes, path.posix.basename(sourcePath));
            }
        }, tree.files[0] ? tree.files[0].size : null);
        return;
    }

    if (options.session && tree.files.length >= TAR_MIN_FILES && await sessionSupportsTar(options.session)) {
        await fs.promises.mkdir(destinationPath, { recursive: true });
        await tarTransfer.downloadDirectory(options.session.conn, sourcePath, destinationPath, {
            onBytes: (bytes) => {
                if (progressReporter) progressReporter.advance(bytes, path.posix.basename(sourcePath));
            },
            excludePatterns: exclude ? exclude.patterns : []
        });

        const delivered = await countLocalFiles(destinationPath);
        if (delivered < tree.files.length) {
            throw new Error(`Transfer verification failed: ${delivered} of ${tree.files.length} files arrived at ${destinationPath}.`);
        }
        return;
    }

    await createLocalDirs(destinationPath, tree.dirs);

    await runWithConcurrency(tree.files, async (file) => {
        const source = path.posix.join(sourcePath, file.relative);
        const target = path.join(destinationPath, file.relative);
        await copyRemoteFileToLocalWithProgress(sftp, source, target, (bytes) => {
            if (progressReporter) {
                progressReporter.advance(bytes, path.posix.basename(source));
            }
        }, file.size);
    });
}

function copyRemoteFileViaStream(sftp, sourcePath, destinationPath) {
    return new Promise((resolve, reject) => {
        const readStream = sftp.createReadStream(sourcePath);
        const writeStream = sftp.createWriteStream(destinationPath);
        let settled = false;
        let finished = false;

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
        writeStream.on('finish', () => {
            finished = true;
            finish();
        });
        writeStream.on('close', () => {
            if (!finished) {
                finish();
            }
        });
        readStream.pipe(writeStream);
    });
}

async function copyRemoteToRemote(sftp, sourcePath, destinationPath, options = {}) {
    const knownDirs = options.knownDirs || new Set();
    const tree = options.tree || await collectRemoteTree(sftp, sourcePath);

    if (!tree.isDirectory) {
        await ensureRemoteDir(sftp, path.posix.dirname(destinationPath), knownDirs);
        await copyRemoteFileViaStream(sftp, sourcePath, destinationPath);
        return;
    }

    await createRemoteDirs(sftp, destinationPath, tree.dirs, knownDirs);

    await runWithConcurrency(tree.files, async (file) => {
        await copyRemoteFileViaStream(
            sftp,
            path.posix.join(sourcePath, file.relative),
            path.posix.join(destinationPath, file.relative)
        );
    });
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
        const sessionId = normalizeId(createSessionId());

        return await new Promise((resolve) => {
            let settled = false;

            const finish = (result) => {
                if (settled) return;
                settled = true;
                resolve(result);
            };

            conn.once('ready', () => {
                // Without this every SFTP round trip pays a Nagle/delayed-ACK
                // stall, which dominates transfers of many small files.
                try {
                    conn.setNoDelay(true);
                } catch (_) {}

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
                    const desktopPath = await findRemoteDesktopPath(sftp, homePath);
                    const initialPath = desktopPath || homePath;

                    const session = {
                        id: sessionId,
                        hostId: normalizeId(host.id),
                        conn,
                        sftp,
                        homePath,
                        createdAt: Date.now(),
                        lastUsedAt: Date.now(),
                        lastKeepaliveAt: null,
                        keepaliveTimer: null,
                        keepaliveInFlight: false,
                        isClosing: false
                    };

                    sessions.set(sessionId, session);
                    startSessionKeepalive(session);

                    conn.on('close', () => {
                        clearSessionKeepalive(session);
                        sessions.delete(sessionId);
                    });

                    finish({
                        success: true,
                        sessionId,
                        homePath,
                        initialPath,
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

    session.isClosing = true;
    clearSessionKeepalive(session);
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

async function copyItems(payload = {}, onProgress = null) {
    try {
        const sourceSide = normalizeSide(payload.sourceSide);
        const destinationSide = normalizeSide(payload.destinationSide);
        const conflictPolicy = normalizeConflictPolicy(payload.conflictPolicy);
        const dryRun = Boolean(payload.dryRun);
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
        if (!dryRun && isCrossSessionRemoteCopy) {
            crossSessionTempRoot = await fs.promises.mkdtemp(
                path.join(os.tmpdir(), 'termix-sftp-bridge-')
            );
        }

        let progressReporter = null;
        const progressDirection = dryRun
            ? null
            : (sourceSide === 'local' && destinationSide === 'remote'
                ? 'upload'
                : (sourceSide === 'remote' && destinationSide === 'local' ? 'download' : null));

        // The tree walk feeds both the progress total and the copy itself, so a
        // large folder is only enumerated once.
        const treeCache = new Map();
        const knownRemoteDirs = new Set();

        const sftpSettings = normalizeSftpSettings(db.get('sftpSettings'));
        const exclude = sftpSettings.skipPatternsEnabled
            ? createExcludeMatcher(sftpSettings.skipPatterns)
            : null;
        let skippedCount = 0;

        if (progressDirection) {
            let totalBytes = 0;
            for (const item of normalizedItems) {
                const tree = sourceSide === 'local'
                    ? await collectLocalTree(item.path, exclude)
                    : await collectRemoteTree(sourceSession.sftp, item.path, exclude);
                treeCache.set(item.path, tree);
                totalBytes += tree.totalBytes;
                skippedCount += Number(tree.skipped || 0);
            }

            progressReporter = createCopyProgressReporter({
                operationId: payload.operationId,
                direction: progressDirection,
                totalBytes,
                onProgress
            });
        }

        let copiedCount = 0;
        const conflicts = [];

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

                const preferredTargetPath = destinationSide === 'local'
                    ? path.join(destinationPath, name)
                    : path.posix.join(destinationPath, name);

                const samePhysicalTarget = sourceSide === destinationSide
                    && (
                        destinationSide === 'local'
                            ? localPathsMatch(sourcePath, preferredTargetPath)
                            : (!isCrossSessionRemoteCopy && remotePathsMatch(sourcePath, preferredTargetPath))
                    );

                let targetPath = preferredTargetPath;
                let targetExists = false;

                if (samePhysicalTarget) {
                    targetPath = destinationSide === 'local'
                        ? await resolveUniqueLocalTarget(destinationPath, name, resolvedIsDirectory)
                        : await resolveUniqueRemoteTarget(destinationSession.sftp, destinationPath, name, resolvedIsDirectory);
                } else {
                    targetExists = destinationSide === 'local'
                        ? await localExists(targetPath)
                        : await remoteExists(destinationSession.sftp, targetPath);

                    if (targetExists && conflictPolicy === 'rename') {
                        targetPath = destinationSide === 'local'
                            ? await resolveUniqueLocalTarget(destinationPath, name, resolvedIsDirectory)
                            : await resolveUniqueRemoteTarget(destinationSession.sftp, destinationPath, name, resolvedIsDirectory);
                        targetExists = false;
                    } else if (targetExists && conflictPolicy === 'error') {
                        const conflict = buildCopyConflict({
                            name,
                            sourcePath,
                            targetPath,
                            isDirectory: resolvedIsDirectory,
                            destinationSide
                        });

                        if (dryRun) {
                            conflicts.push(conflict);
                            continue;
                        }

                        return {
                            success: false,
                            conflict: true,
                            conflictItem: conflict,
                            conflictCount: 1,
                            conflicts: [conflict],
                            message: `A file or folder named '${name}' already exists at the target.`
                        };
                    }
                }

                if (sourceSide === 'local' && destinationSide === 'local') {
                    if (resolvedIsDirectory && isNestedLocalPath(sourcePath, targetPath)) {
                        throw new Error(`Cannot copy folder into itself: ${sourcePath}`);
                    }
                    if (dryRun) {
                        continue;
                    }
                    if (targetExists && conflictPolicy === 'overwrite') {
                        await removeLocalPath(targetPath);
                    }
                    await copyLocalPath(sourcePath, targetPath);
                } else if (sourceSide === 'local' && destinationSide === 'remote') {
                    if (dryRun) {
                        continue;
                    }
                    if (targetExists && conflictPolicy === 'overwrite') {
                        await removeRemotePath(destinationSession.sftp, targetPath);
                    }
                    await copyLocalToRemote(destinationSession.sftp, sourcePath, targetPath, progressReporter, {
                        tree: treeCache.get(sourcePath),
                        knownDirs: knownRemoteDirs,
                        session: destinationSession,
                        exclude
                    });
                } else if (sourceSide === 'remote' && destinationSide === 'local') {
                    if (dryRun) {
                        continue;
                    }
                    if (targetExists && conflictPolicy === 'overwrite') {
                        await removeLocalPath(targetPath);
                    }
                    await copyRemoteToLocal(sourceSession.sftp, sourcePath, targetPath, progressReporter, {
                        tree: treeCache.get(sourcePath),
                        session: sourceSession,
                        exclude
                    });
                } else {
                    if (resolvedIsDirectory && isNestedRemotePath(sourcePath, targetPath) && !isCrossSessionRemoteCopy) {
                        throw new Error(`Cannot copy folder into itself: ${sourcePath}`);
                    }
                    if (dryRun) {
                        continue;
                    }
                    if (targetExists && conflictPolicy === 'overwrite') {
                        await removeRemotePath(destinationSession.sftp, targetPath);
                    }

                    if (isCrossSessionRemoteCopy) {
                        const bridgePath = path.join(crossSessionTempRoot, name);
                        if (await localExists(bridgePath)) {
                            await removeLocalPath(bridgePath);
                        }
                        await copyRemoteToLocal(sourceSession.sftp, sourcePath, bridgePath, progressReporter, {
                            session: sourceSession,
                            exclude
                        });
                        await copyLocalToRemote(destinationSession.sftp, bridgePath, targetPath, progressReporter, {
                            session: destinationSession,
                            exclude
                        });
                        await removeLocalPath(bridgePath);
                    } else {
                        await copyRemoteToRemote(destinationSession.sftp, sourcePath, targetPath, {
                            knownDirs: knownRemoteDirs
                        });
                    }
                }

                copiedCount += 1;
            }
        } finally {
            if (crossSessionTempRoot) {
                await removeLocalPath(crossSessionTempRoot);
            }
        }

        if (dryRun) {
            return {
                success: true,
                dryRun: true,
                hasConflicts: conflicts.length > 0,
                conflictCount: conflicts.length,
                conflicts
            };
        }

        if (progressReporter) {
            progressReporter.complete('');
        }

        return {
            success: true,
            copiedCount,
            skippedCount,
            skippedPatterns: skippedCount > 0 && exclude ? exclude.patterns : []
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
