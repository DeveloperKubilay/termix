'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const crypto = require('crypto');
const db = require('../../profile-db');
const { DATA_ROOT } = require('../../paths');

const PREPARE_TTL_MS = 120 * 1000;
const HANDSHAKE_TIMEOUT_MS = 10 * 1000;
const SOCKET_INACTIVITY_MS = 120 * 1000;
const MAX_CONCURRENT_TRANSFERS = 2;
const MAX_HEADER_LENGTH = 4096;
const MAX_HISTORY = 50;

function getStreamOptions(size) {
    const bytes = Number(size || 0);
    const chunkSize = bytes > 8 * 1024 * 1024 ? 256 * 1024 : 128 * 1024;
    return {
        chunkSize,
        highWaterMark: 1024 * 1024,
        concurrency: 32
    };
}

function getJournalDir() {
    const root = process.env.TERMIX_DATA_ROOT || DATA_ROOT;
    return path.join(root, 'local', 'transfers');
}

function getStagingRoot() {
    const root = process.env.TERMIX_DATA_ROOT || DATA_ROOT;
    return path.join(root, 'local', 'staging');
}

function encodeFrame(obj) {
    const payload = Buffer.from(JSON.stringify(obj), 'utf8');
    if (payload.length > MAX_HEADER_LENGTH) {
        throw new Error('Framed message payload exceeds maximum header length (4096 bytes)');
    }
    const buf = Buffer.alloc(4 + payload.length);
    buf.writeUInt32BE(payload.length, 0);
    payload.copy(buf, 4);
    return buf;
}

function validateName(name) {
    if (typeof name !== 'string' || !name.trim()) {
        throw Object.assign(new Error('Filename is required.'), { code: 'INVALID_NAME' });
    }
    const trimmed = name.trim();
    if (trimmed === '.' || trimmed === '..') {
        throw Object.assign(new Error('Filename cannot be "." or "..".'), { code: 'INVALID_NAME' });
    }
    if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
        throw Object.assign(new Error('Filename cannot contain path separators or null bytes.'), { code: 'INVALID_NAME' });
    }
    if (path.posix.basename(trimmed) !== trimmed) {
        throw Object.assign(new Error('Invalid filename.'), { code: 'INVALID_NAME' });
    }
    return trimmed;
}

function isNoSuchFile(err) {
    if (!err) return false;
    if (err.code === 'ENOENT') return true;
    if (Number(err.code) === 2 || Number(err.errno) === 2) return true;
    const msg = String(err.message || '').toLowerCase();
    return msg.includes('no such file');
}

function sftpStat(sftp, remotePath) {
    return new Promise((resolve, reject) => {
        sftp.stat(remotePath, (err, stats) => {
            if (err) reject(err);
            else resolve(stats);
        });
    });
}

function sftpRename(sftp, from, to) {
    return new Promise((resolve, reject) => {
        sftp.rename(from, to, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

async function sftpAtomicRename(sftp, tempPath, destPath) {
    let destExists = false;
    try {
        await sftpStat(sftp, destPath);
        destExists = true;
    } catch (err) {
        if (!isNoSuchFile(err)) throw err;
    }

    if (!destExists) {
        return sftpRename(sftp, tempPath, destPath);
    }

    if (typeof sftp.ext_openssh_rename !== 'function') {
        throw Object.assign(
            new Error('Atomic overwrite not supported: destination file already exists and server does not support posix-rename@openssh.com'),
            { code: 'OVERWRITE_UNSUPPORTED', destinationExists: true }
        );
    }

    return new Promise((resolve, reject) => {
        try {
            sftp.ext_openssh_rename(tempPath, destPath, (err) => {
                if (err) {
                    reject(Object.assign(
                        new Error(`Atomic overwrite failed: ${err.message}`),
                        { code: 'OVERWRITE_FAILED', cause: err, destinationExists: true }
                    ));
                } else {
                    resolve();
                }
            });
        } catch (syncErr) {
            reject(Object.assign(
                new Error(`Atomic overwrite not supported: ${syncErr.message}`),
                { code: 'OVERWRITE_UNSUPPORTED', cause: syncErr, destinationExists: true }
            ));
        }
    });
}

async function cleanupTemp(sftp, tempPath) {
    if (!sftp || !tempPath) return;
    try {
        await new Promise((resolve) => sftp.unlink(tempPath, () => resolve()));
    } catch (_) {}
}

async function writeJournal(transfer) {
    const journalDir = getJournalDir();
    await fs.promises.mkdir(journalDir, { recursive: true, mode: 0o700 });
    const journalFile = path.join(journalDir, `${transfer.id}.json`);
    const tempFile = path.join(journalDir, `${transfer.id}.tmp`);
    let profileId = 'default';
    try {
        if (typeof db.getActiveProfilePath === 'function') {
            profileId = path.basename(db.getActiveProfilePath(), '.json');
        }
    } catch (_) {}

    const data = JSON.stringify({
        transferId: transfer.id,
        direction: transfer.direction,
        profileId,
        hostId: transfer.hostId,
        remotePath: transfer.remotePath,
        remoteTempPath: transfer.tempPath,
        destinationPath: transfer.destinationPath,
        state: transfer.state,
        createdAt: transfer.createdAt
    });
    await fs.promises.writeFile(tempFile, data, { encoding: 'utf8', mode: 0o600 });
    await fs.promises.rename(tempFile, journalFile);
}

async function removeJournal(transferId) {
    try {
        const journalFile = path.join(getJournalDir(), `${transferId}.json`);
        await fs.promises.unlink(journalFile);
    } catch (_) {}
}

async function cleanLegacyStaging(overrideRoot) {
    const stagingRoot = overrideRoot || getStagingRoot();
    if (!fs.existsSync(stagingRoot)) return;
    try {
        const resolvedRoot = path.resolve(stagingRoot);
        const entries = await fs.promises.readdir(resolvedRoot, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isSymbolicLink()) continue;
            const entryPath = path.join(resolvedRoot, entry.name);
            if (!entryPath.startsWith(resolvedRoot + path.sep)) continue;
            await fs.promises.rm(entryPath, { recursive: true, force: true });
        }
    } catch (_) {}
}

function createTransferManager(emit, options = {}) {
    let closed = false;
    const activeTransfersMap = new Map();
    const historyList = [];
    const sftpSessions = new Map();

    const onCountChange = typeof options.onCountChange === 'function' ? options.onCountChange : () => {};

    const socketDir = process.env.TERMIX_ANDROID_SOCKET
        ? path.dirname(process.env.TERMIX_ANDROID_SOCKET)
        : (process.env.TERMIX_DATA_ROOT ? path.join(process.env.TERMIX_DATA_ROOT, 'files') : path.join(DATA_ROOT, 'files'));

    const transferSocketPath = options.transferSocketPath || path.join(socketDir, 't.sock');

    if (Buffer.byteLength(transferSocketPath) > 100 && process.platform !== 'win32') {
        throw new Error(`Transfer socket path exceeds 100 bytes limit: ${transferSocketPath}`);
    }

    function emitProgress(transfer) {
        if (closed) return;
        try {
            emit('android:transfer-progress', {
                transferId: transfer.id,
                direction: transfer.direction,
                bytes: transfer.bytesTransferred,
                totalBytes: transfer.size,
                state: transfer.state,
                error: transfer.error ? transfer.error.message : undefined
            });
        } catch (_) {}
    }

    let lastProgressEmit = 0;
    function emitProgressThrottled(transfer) {
        const now = Date.now();
        if (now - lastProgressEmit >= 100) {
            lastProgressEmit = now;
            emitProgress(transfer);
        }
    }

    function getActiveCount() {
        let count = 0;
        for (const t of activeTransfersMap.values()) {
            if (!t.decremented && (t.state === 'prepared' || t.state === 'starting' || t.state === 'transferring' || t.state === 'finalizing' || t.state === 'awaiting_ack')) {
                count++;
            }
        }
        return count;
    }

    function decrementActive(transfer) {
        if (transfer.decremented) return;
        transfer.decremented = true;
        activeTransfersMap.delete(transfer.id);
        onCountChange();
    }

    function addToHistory(transfer) {
        historyList.push(transfer);
        if (historyList.length > MAX_HISTORY) {
            historyList.shift();
        }
    }

    function failTransfer(transfer, err) {
        if (transfer.state === 'completed' || transfer.state === 'cancelled') return;
        transfer.state = 'error';
        transfer.error = err;
        emitProgress(transfer);
        decrementActive(transfer);
    }

    const server = net.createServer({ allowHalfOpen: true }, (socket) => {
        handleConnection(socket);
    });

    let isListening = false;
    let listenPort = null;

    async function startServer() {
        if (isListening) return;

        if (fs.existsSync(transferSocketPath)) {
            let stat;
            try {
                stat = fs.lstatSync(transferSocketPath);
            } catch (_) {}
            if (stat && stat.isSocket()) {
                try { fs.unlinkSync(transferSocketPath); } catch (_) {}
            } else if (stat) {
                throw new Error('Transfer socket path already exists and is not a socket.');
            }
        }

        await new Promise((resolve, reject) => {
            const onError = (err) => {
                if (process.platform === 'win32' || err.code === 'EACCES') {
                    server.listen(0, '127.0.0.1', () => {
                        listenPort = server.address().port;
                        isListening = true;
                        resolve();
                    });
                    return;
                }
                reject(err);
            };

            server.once('error', onError);

            if (process.platform === 'win32') {
                server.listen(0, '127.0.0.1', () => {
                    server.removeListener('error', onError);
                    listenPort = server.address().port;
                    isListening = true;
                    resolve();
                });
            } else {
                server.listen(transferSocketPath, () => {
                    server.removeListener('error', onError);
                    isListening = true;
                    try { fs.chmodSync(transferSocketPath, 0o600); } catch (_) {}
                    resolve();
                });
            }
        });
    }

    function getSocketPath() {
        if (listenPort && process.platform === 'win32') {
            return `127.0.0.1:${listenPort}`;
        }
        return transferSocketPath;
    }

    function handleConnection(socket) {
        if (closed) {
            socket.destroy();
            return;
        }

        if (process.platform === 'linux' && typeof process.getuid === 'function') {
            const handle = socket._handle;
            if (handle && typeof handle.getPeerCredentials === 'function') {
                try {
                    const creds = handle.getPeerCredentials();
                    if (creds && typeof creds.uid === 'number' && creds.uid !== process.getuid()) {
                        socket.destroy();
                        return;
                    }
                } catch (_) {}
            }
        }

        let handshakeTimer = setTimeout(() => {
            socket.destroy();
        }, HANDSHAKE_TIMEOUT_MS);

        let inactivityTimer = null;
        function resetInactivity() {
            clearTimeout(inactivityTimer);
            inactivityTimer = setTimeout(() => {
                if (activeTransfer) {
                    failTransfer(activeTransfer, new Error('Transfer stalled: socket inactivity for 120 seconds.'));
                }
                socket.destroy();
            }, SOCKET_INACTIVITY_MS);
        }

        let headerBuffer = Buffer.alloc(0);
        let activeTransfer = null;
        let handshakeDone = false;

        const onData = (chunk) => {
            if (handshakeDone) return;
            headerBuffer = Buffer.concat([headerBuffer, chunk]);

            if (headerBuffer.length >= 4) {
                const len = headerBuffer.readUInt32BE(0);
                if (len <= 0 || len > MAX_HEADER_LENGTH) {
                    clearTimeout(handshakeTimer);
                    socket.destroy();
                    return;
                }

                if (headerBuffer.length >= 4 + len) {
                    clearTimeout(handshakeTimer);
                    const jsonBuf = headerBuffer.subarray(4, 4 + len);
                    const remainingData = headerBuffer.subarray(4 + len);
                    headerBuffer = null;

                    let handshake;
                    try {
                        handshake = JSON.parse(jsonBuf.toString('utf8'));
                    } catch (_) {
                        socket.write(encodeFrame({ success: false, error: 'Malformed handshake JSON.' }));
                        socket.destroy();
                        return;
                    }

                    const { transferId, token, direction } = handshake || {};
                    const transfer = activeTransfersMap.get(transferId);
                    if (!transfer || transfer.state !== 'prepared') {
                        socket.write(encodeFrame({ success: false, error: 'Transfer not found or expired.' }));
                        socket.destroy();
                        return;
                    }

                    if (transfer.direction !== direction) {
                        socket.write(encodeFrame({ success: false, error: 'Transfer direction mismatch.' }));
                        socket.destroy();
                        return;
                    }

                    if (!transfer.token) {
                        socket.write(encodeFrame({ success: false, error: 'Transfer token already consumed.' }));
                        socket.destroy();
                        return;
                    }

                    const expectedToken = transfer.token;
                    const providedToken = Buffer.isBuffer(token) ? token : Buffer.from(String(token || ''), 'hex');
                    if (expectedToken.length !== providedToken.length || !crypto.timingSafeEqual(expectedToken, providedToken)) {
                        socket.write(encodeFrame({ success: false, error: 'Invalid transfer token.' }));
                        socket.destroy();
                        return;
                    }

                    transfer.token = null;
                    if (transfer.prepareTimer) {
                        clearTimeout(transfer.prepareTimer);
                        transfer.prepareTimer = null;
                    }
                    transfer.socket = socket;
                    activeTransfer = transfer;
                    handshakeDone = true;

                    socket.pause(); socket.removeListener('data', onData);
                    socket.write(encodeFrame({ success: true, size: transfer.size }));

                    resetInactivity();

                    if (transfer.direction === 'upload') {
                        startUpload(transfer, socket, remainingData, resetInactivity);
                    } else {
                        startDownload(transfer, socket, remainingData, resetInactivity);
                    }
                }
            }
        };

        socket.on('data', onData);
        socket.once('close', () => {
            clearTimeout(handshakeTimer);
            clearTimeout(inactivityTimer);
        });
    }

    async function startUpload(transfer, socket, remainingData, resetInactivity) {
        transfer.state = 'starting';
        emitProgress(transfer);

        const session = sftpSessions.get(transfer.sessionId);
        if (!session || !session.sftp) {
            failTransfer(transfer, new Error('SFTP session not found or disconnected.'));
            socket.destroy();
            return;
        }
        const sftp = session.sftp;

        const destPath = transfer.destinationPath;
        const tempFileName = `.termix-part-${crypto.randomUUID()}`;
        transfer.tempPath = path.posix.join(transfer.remotePath, tempFileName);

        try {
            await writeJournal(transfer);
            transfer.journalWritten = true;
        } catch (err) {
            failTransfer(transfer, new Error(`Failed to write transfer journal: ${err.message}`));
            socket.destroy();
            return;
        }

        let writeStream;
        try {
            const streamOpts = getStreamOptions(transfer.size);
            writeStream = sftp.createWriteStream(transfer.tempPath, { flags: 'wx', ...streamOpts });
            transfer.stream = writeStream;
        } catch (err) {
            failTransfer(transfer, new Error(`Failed to create remote temp file: ${err.message}`));
            await cleanupTemp(sftp, transfer.tempPath);
            await removeJournal(transfer.id);
            socket.destroy();
            return;
        }

        transfer.state = 'transferring';
        emitProgress(transfer);

        let streamError = null;

        const onStreamError = async (err) => {
            if (streamError) return;
            streamError = err;
            failTransfer(transfer, err);
            socket.destroy();
            await cleanupTemp(sftp, transfer.tempPath);
            await removeJournal(transfer.id);
        };

        writeStream.once('error', onStreamError);

        socket.on('data', (chunk) => {
            resetInactivity();
            transfer.bytesTransferred += chunk.length;
            emitProgressThrottled(transfer);

            const ok = writeStream.write(chunk);
            if (!ok) {
                socket.pause();
                writeStream.once('drain', () => socket.resume());
            }
        });

        if (remainingData && remainingData.length > 0) {
            transfer.bytesTransferred += remainingData.length;
            emitProgressThrottled(transfer);
            const ok = writeStream.write(remainingData);
            if (!ok) {
                socket.pause();
                writeStream.once('drain', () => socket.resume());
            }
        }

        socket.on('end', async () => {
            if (streamError) return;
            transfer.state = 'finalizing';
            emitProgress(transfer);

            try {
                await new Promise((resolve, reject) => {
                    writeStream.once('error', reject);
                    writeStream.end(() => {
                        if (typeof writeStream.close === 'function') {
                            writeStream.close((err) => (err ? reject(err) : resolve()));
                        } else {
                            resolve();
                        }
                    });
                });
            } catch (err) {
                onStreamError(err);
                return;
            }

            if (streamError) return;

            if (transfer.size !== null && transfer.bytesTransferred !== transfer.size) {
                const err = new Error(`Upload size mismatch: expected ${transfer.size}, got ${transfer.bytesTransferred}`);
                failTransfer(transfer, err);
                await cleanupTemp(sftp, transfer.tempPath);
                await removeJournal(transfer.id);
                try {
                    socket.end(encodeFrame({ success: false, error: err.message }));
                } catch (_) {}
                return;
            }

            try {
                await sftpAtomicRename(sftp, transfer.tempPath, destPath);
            } catch (renameErr) {
                failTransfer(transfer, renameErr);
                await cleanupTemp(sftp, transfer.tempPath);
                await removeJournal(transfer.id);
                try {
                    socket.end(encodeFrame({ success: false, error: renameErr.message }));
                } catch (_) {}
                return;
            }

            await removeJournal(transfer.id);
            transfer.state = 'completed';
            emitProgress(transfer);
            decrementActive(transfer);

            try {
                socket.end(encodeFrame({ success: true, bytes: transfer.bytesTransferred }));
            } catch (_) {}
        });

        socket.resume();
        socket.on('error', async (err) => {
            if (transfer.state !== 'completed') {
                failTransfer(transfer, err);
                await cleanupTemp(sftp, transfer.tempPath);
                await removeJournal(transfer.id);
            }
        });
    }

    async function startDownload(transfer, socket, remainingData, resetInactivity) {
        transfer.state = 'starting';
        emitProgress(transfer);

        const session = sftpSessions.get(transfer.sessionId);
        if (!session || !session.sftp) {
            failTransfer(transfer, new Error('SFTP session not found or disconnected.'));
            socket.destroy();
            return;
        }
        const sftp = session.sftp;

        let readStream;
        try {
            const streamOpts = getStreamOptions(transfer.size);
            readStream = sftp.createReadStream(transfer.remotePath, streamOpts);
            transfer.stream = readStream;
        } catch (err) {
            failTransfer(transfer, new Error(`Failed to open remote file: ${err.message}`));
            socket.destroy();
            return;
        }

        transfer.state = 'transferring';
        emitProgress(transfer);

        let streamError = null;

        readStream.once('error', (err) => {
            if (streamError) return;
            streamError = err;
            failTransfer(transfer, err);
            socket.destroy();
        });

        readStream.on('data', (chunk) => {
            resetInactivity();
            transfer.bytesTransferred += chunk.length;
            emitProgressThrottled(transfer);

            const ok = socket.write(chunk);
            if (!ok) {
                readStream.pause();
                socket.once('drain', () => readStream.resume());
            }
        });

        readStream.on('end', async () => {
            if (streamError) return;

            if (socket.writableLength > 0) {
                await new Promise((resolve) => socket.once('drain', resolve));
            }

            if (transfer.size !== null && transfer.bytesTransferred !== transfer.size) {
                const err = new Error(`Download size mismatch: expected ${transfer.size}, sent ${transfer.bytesTransferred}`);
                failTransfer(transfer, err);
                socket.destroy();
                return;
            }

            transfer.state = 'awaiting_ack';
            emitProgress(transfer);

            let ackBuffer = remainingData && remainingData.length > 0 ? remainingData : Buffer.alloc(0);

            const onAckData = (chunk) => {
                resetInactivity();
                ackBuffer = Buffer.concat([ackBuffer, chunk]);
                if (ackBuffer.length >= 4) {
                    const len = ackBuffer.readUInt32BE(0);
                    if (len > MAX_HEADER_LENGTH || len <= 0) {
                        socket.removeListener('data', onAckData);
                        failTransfer(transfer, new Error('Malformed ACK frame header.'));
                        socket.destroy();
                        return;
                    }
                    if (ackBuffer.length >= 4 + len) {
                        socket.removeListener('data', onAckData);
                        const jsonBuf = ackBuffer.subarray(4, 4 + len);
                        let ack;
                        try {
                            ack = JSON.parse(jsonBuf.toString('utf8'));
                        } catch (_) {
                            failTransfer(transfer, new Error('Malformed ACK JSON.'));
                            socket.destroy();
                            return;
                        }

                        if (!ack || ack.success !== true || ack.bytes !== transfer.size) {
                            failTransfer(transfer, new Error(`Invalid download ACK: expected ${transfer.size} bytes, got ${ack ? ack.bytes : 'none'}`));
                            socket.destroy();
                            return;
                        }

                        transfer.state = 'completed';
                        emitProgress(transfer);
                        decrementActive(transfer);

                        try {
                            socket.end(encodeFrame({ success: true, bytes: transfer.bytesTransferred }));
                        } catch (_) {}
                    }
                }
            };

            socket.on('data', onAckData);
            socket.resume();
            if (ackBuffer.length > 0) {
                onAckData(Buffer.alloc(0));
            }
        });

        socket.on('error', (err) => {
            if (transfer.state !== 'completed') {
                failTransfer(transfer, err);
            }
        });
    }

    async function cleanupJournalOnReconnect(hostId, sftp) {
        if (!sftp || !hostId) return;
        const journalDir = getJournalDir();
        let files;
        try {
            files = await fs.promises.readdir(journalDir);
        } catch (_) {
            return;
        }

        let currentProfileId = 'default';
        try {
            if (typeof db.getActiveProfilePath === 'function') {
                currentProfileId = path.basename(db.getActiveProfilePath(), '.json');
            }
        } catch (_) {}

        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            const filePath = path.join(journalDir, file);
            try {
                const raw = await fs.promises.readFile(filePath, 'utf8');
                const entry = JSON.parse(raw);
                if (entry.profileId !== currentProfileId || String(entry.hostId) !== String(hostId)) {
                    continue;
                }

                const tempPath = entry.remoteTempPath;
                const basename = path.posix.basename(tempPath);
                if (!/^\.termix-part-[0-9a-fA-F-]{36}$/.test(basename)) {
                    continue;
                }

                let stat;
                try {
                    stat = await sftpStat(sftp, tempPath);
                } catch (err) {
                    if (isNoSuchFile(err)) {
                        await fs.promises.unlink(filePath);
                    }
                    continue;
                }

                if (stat.isSymbolicLink?.() || (stat.mode && (stat.mode & 0o170000) === 0o120000)) {
                    continue;
                }
                if (stat.isDirectory?.() || (stat.mode && (stat.mode & 0o170000) === 0o040000)) {
                    continue;
                }

                await new Promise((resolve) => sftp.unlink(tempPath, () => resolve()));
                await fs.promises.unlink(filePath);
            } catch (_) {}
        }
    }

    return {
        async prepare({ direction, sessionId, remotePath, name, size } = {}) {
            if (closed) throw new Error('Backend transport is closed.');

            if (direction !== 'upload' && direction !== 'download') {
                throw Object.assign(new Error('Invalid direction: must be "upload" or "download".'), { code: 'INVALID_ARGUMENT' });
            }

            if (!sessionId || typeof sessionId !== 'string') {
                throw Object.assign(new Error('Valid sessionId is required.'), { code: 'INVALID_ARGUMENT' });
            }

            const session = sftpSessions.get(sessionId);
            if (!session || !session.sftp) {
                throw Object.assign(new Error('SFTP session not found or inactive.'), { code: 'SESSION_NOT_FOUND' });
            }
            const { sftp, hostId } = session;

            if (!remotePath || typeof remotePath !== 'string') {
                throw Object.assign(new Error('Valid remotePath is required.'), { code: 'INVALID_ARGUMENT' });
            }

            if (getActiveCount() >= MAX_CONCURRENT_TRANSFERS) {
                throw Object.assign(new Error('Maximum concurrent transfers reached (2).'), { code: 'MAX_TRANSFERS_EXCEEDED' });
            }

            await startServer();

            let fileName = name;
            let expectedSize = null;
            let destinationPath = null;

            if (direction === 'upload') {
                if (!fileName || typeof fileName !== 'string') {
                    throw Object.assign(new Error('Filename is required for upload.'), { code: 'INVALID_ARGUMENT' });
                }
                fileName = fileName.trim();
                validateName(fileName);
                destinationPath = path.posix.join(remotePath, fileName);
                if (size !== undefined && size !== null) {
                    const numSize = Number(size);
                    if (!Number.isFinite(numSize) || numSize < 0) {
                        throw Object.assign(new Error('Invalid size for upload.'), { code: 'INVALID_ARGUMENT' });
                    }
                    expectedSize = numSize;
                }
            } else {
                if (!fileName) {
                    fileName = path.posix.basename(remotePath);
                }
                if (!fileName || fileName === '.' || fileName === '/') {
                    throw Object.assign(new Error('Only regular files can be downloaded (not directories).'), { code: 'NOT_REGULAR_FILE' });
                }
                validateName(fileName);
                destinationPath = remotePath;

                let stat;
                try {
                    stat = await sftpStat(sftp, remotePath);
                } catch (err) {
                    throw Object.assign(new Error(`Failed to stat remote file: ${err.message}`), { code: 'STAT_FAILED', cause: err });
                }

                const isRegular = typeof stat.isFile === 'function' ? stat.isFile() : (stat.mode && (stat.mode & 0o170000) === 0o100000);
                if (!isRegular) {
                    throw Object.assign(new Error('Only regular files can be downloaded.'), { code: 'NOT_REGULAR_FILE' });
                }

                expectedSize = Number(stat.size);
                if (!Number.isFinite(expectedSize) || expectedSize < 0) {
                    throw Object.assign(new Error('Invalid file size returned by server.'), { code: 'INVALID_SIZE' });
                }
            }

            const transferId = crypto.randomUUID();
            const tokenBuffer = crypto.randomBytes(32);
            const token = tokenBuffer.toString('hex');

            const transfer = {
                id: transferId,
                direction,
                sessionId,
                hostId,
                remotePath,
                name: fileName,
                destinationPath,
                tempPath: null,
                size: expectedSize,
                token: tokenBuffer,
                state: 'prepared',
                bytesTransferred: 0,
                totalBytes: expectedSize,
                error: null,
                createdAt: Date.now(),
                decremented: false,
                journalWritten: false,
                socket: null,
                stream: null
            };

            transfer.prepareTimer = setTimeout(() => {
                if (transfer.state === 'prepared') {
                    failTransfer(transfer, new Error('Transfer expired: handshake not initiated within 120 seconds.'));
                }
            }, PREPARE_TTL_MS);

            activeTransfersMap.set(transferId, transfer);
            addToHistory(transfer);
            onCountChange();

            emitProgress(transfer);

            return {
                success: true,
                transferId,
                socketPath: getSocketPath(),
                token,
                size: expectedSize,
                direction
            };
        },

        status(transferId) {
            if (transferId) {
                const t = activeTransfersMap.get(transferId) || historyList.find((x) => x.id === transferId);
                if (!t) return { success: false, error: 'Transfer not found.' };
                return {
                    success: true,
                    transfer: {
                        transferId: t.id,
                        direction: t.direction,
                        state: t.state,
                        bytes: t.bytesTransferred,
                        totalBytes: t.size,
                        name: t.name,
                        error: t.error ? t.error.message : null
                    }
                };
            }
            const list = Array.from(activeTransfersMap.values()).map((t) => ({
                transferId: t.id,
                direction: t.direction,
                state: t.state,
                bytes: t.bytesTransferred,
                totalBytes: t.size,
                name: t.name,
                error: t.error ? t.error.message : null
            }));
            return { success: true, transfers: list };
        },

        async cancel(transferId) {
            if (!transferId) return { success: false, error: 'transferId is required.' };
            const transfer = activeTransfersMap.get(transferId);
            if (!transfer) return { success: true };

            if (transfer.state === 'completed' || transfer.state === 'cancelled') {
                return { success: true };
            }

            transfer.state = 'cancelled';
            if (transfer.prepareTimer) {
                clearTimeout(transfer.prepareTimer);
                transfer.prepareTimer = null;
            }

            if (transfer.stream) {
                try { transfer.stream.destroy(); } catch (_) {}
            }
            if (transfer.socket) {
                try { transfer.socket.destroy(); } catch (_) {}
            }

            if (transfer.tempPath && transfer.direction === 'upload') {
                const session = sftpSessions.get(transfer.sessionId);
                if (session && session.sftp) {
                    await cleanupTemp(session.sftp, transfer.tempPath);
                }
            }

            if (transfer.journalWritten) {
                await removeJournal(transfer.id);
            }

            emitProgress(transfer);
            decrementActive(transfer);
            return { success: true };
        },

        registerSession(sessionId, sessionInfo) {
            sftpSessions.set(sessionId, sessionInfo);
            cleanupJournalOnReconnect(sessionInfo.hostId, sessionInfo.sftp).catch(() => {});
        },

        unregisterSession(sessionId) {
            sftpSessions.delete(sessionId);
            for (const transfer of Array.from(activeTransfersMap.values())) {
                if (transfer.sessionId === sessionId) {
                    this.cancel(transfer.id).catch(() => {});
                }
            }
        },

        async cancelAll() {
            const list = Array.from(activeTransfersMap.values());
            for (const transfer of list) {
                await this.cancel(transfer.id);
            }
        },

        getSession(sessionId) {
            return sftpSessions.get(sessionId);
        },
        getActiveCount,
        startServer,
        getSocketPath,
        handleConnection,
        cleanLegacyStaging,

        async close() {
            closed = true;
            await this.cancelAll();
            activeTransfersMap.clear();
            sftpSessions.clear();

            if (isListening) {
                await new Promise((resolve) => server.close(resolve));
                isListening = false;
                try {
                    if (fs.existsSync(transferSocketPath) && fs.lstatSync(transferSocketPath).isSocket()) {
                        fs.unlinkSync(transferSocketPath);
                    }
                } catch (_) {}
            }
        }
    };
}

module.exports = {
    createTransferManager,
    encodeFrame,
    validateName,
    cleanLegacyStaging,
    PREPARE_TTL_MS,
    HANDSHAKE_TIMEOUT_MS,
    SOCKET_INACTIVITY_MS,
    MAX_CONCURRENT_TRANSFERS,
    MAX_HEADER_LENGTH
};
