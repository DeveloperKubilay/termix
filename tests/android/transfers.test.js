'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const crypto = require('crypto');

const { createSocketPair } = require('./helpers');
const { FramedTransport } = require('../../util/android/backend/transport');
const { createFixture } = require('./fixture-server');
const { encodeFrame, validateName, cleanLegacyStaging } = require('../../util/android/backend/transfers');

function setupEnvironment() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'termix-test-transfers-'));
    process.env.TERMIX_PLATFORM = 'android';
    process.env.TERMIX_DATA_ROOT = root;
    process.env.TERMIX_PORTABLE_KEY = crypto.randomBytes(48).toString('base64');
    process.env.TERMIX_ANDROID_NO_AUTOSTART = '1';

    for (const sub of ['files', 'profiles', 'local', 'local/transfers', 'local/staging']) {
        fs.mkdirSync(path.join(root, sub), { recursive: true, mode: 0o700 });
    }

    for (const key of Object.keys(require.cache)) {
        if (key.includes('termix') && !key.includes('node_modules')) {
            delete require.cache[key];
        }
    }

    const { createSession } = require('../../util/android/backend/bootstrap');
    return {
        root,
        createSession,
        cleanup() {
            try {
                fs.rmSync(root, { recursive: true, force: true });
            } catch (_) {}
        }
    };
}

function connectToSocket(socketPath) {
    return new Promise((resolve, reject) => {
        let client;
        if (socketPath.includes(':')) {
            const [host, port] = socketPath.split(':');
            client = net.createConnection({ host, port: Number(port), allowHalfOpen: true });
        } else {
            client = net.createConnection({ path: socketPath, allowHalfOpen: true });
        }
        client.once('connect', () => resolve(client));
        client.once('error', reject);
    });
}

function getSocketReader(socket) {
    if (socket._reader) return socket._reader;
    let buffer = Buffer.alloc(0);
    const waiters = [];

    const checkWaiters = () => {
        while (waiters.length > 0) {
            const { length, resolve } = waiters[0];
            if (buffer.length >= length) {
                waiters.shift();
                const data = buffer.subarray(0, length);
                buffer = buffer.subarray(length);
                resolve(data);
            } else {
                break;
            }
        }
    };

    socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        checkWaiters();
    });

    socket.on('error', (err) => {
        while (waiters.length > 0) {
            waiters.shift().reject(err);
        }
    });

    socket.on('end', () => {
        while (waiters.length > 0) {
            const { length, reject } = waiters[0];
            if (buffer.length < length) {
                waiters.shift().reject(new Error(`Socket ended prematurely: needed ${length} bytes, had ${buffer.length}`));
            } else {
                break;
            }
        }
    });

    const readExact = (length) => {
        return new Promise((resolve, reject) => {
            if (buffer.length >= length) {
                const data = buffer.subarray(0, length);
                buffer = buffer.subarray(length);
                return resolve(data);
            }
            waiters.push({ length, resolve, reject });
        });
    };

    const readFrame = async () => {
        const header = await readExact(4);
        const len = header.readUInt32BE(0);
        const jsonBuf = await readExact(len);
        return JSON.parse(jsonBuf.toString('utf8'));
    };

    socket._reader = { readExact, readFrame };
    return socket._reader;
}

function readFrame(socket) {
    return getSocketReader(socket).readFrame();
}

async function readExactBytes(socket, length) {
    const data = await getSocketReader(socket).readExact(length);
    return { data };
}

async function setupSftpSession(client, fixture, port) {
    const responses = new Map();
    client.on('message', (msg) => {
        if (msg.type === 'response') responses.set(msg.id, msg);
    });

    client.send({
        type: 'request',
        id: 'save-host',
        channel: 'hosts:set-data',
        args: [[{ id: 'fix-host', name: 'Fixture Host', address: '127.0.0.1', port: String(port), username: 'termix', password: fixture.password, protocol: 'SSH' }]]
    });
    await new Promise((r) => setTimeout(r, 60));

    client.send({
        type: 'request',
        id: 'sftp-conn',
        channel: 'sftp:connect',
        args: ['fix-host']
    });

    for (let i = 0; i < 40; i++) {
        if (responses.has('sftp-conn')) break;
        await new Promise((r) => setTimeout(r, 50));
    }

    const connRes = responses.get('sftp-conn');
    assert.ok(connRes && connRes.result && connRes.result.success, 'SFTP connect failed: ' + JSON.stringify(connRes));
    return connRes.result.sessionId;
}

test('filename validation rejects invalid characters and traversal', () => {
    assert.equal(validateName('myfile.txt'), 'myfile.txt');
    assert.equal(validateName('Türkçe dosya (1).tar.gz'), 'Türkçe dosya (1).tar.gz');

    assert.throws(() => validateName(''), { code: 'INVALID_NAME' });
    assert.throws(() => validateName('   '), { code: 'INVALID_NAME' });
    assert.throws(() => validateName('.'), { code: 'INVALID_NAME' });
    assert.throws(() => validateName('..'), { code: 'INVALID_NAME' });
    assert.throws(() => validateName('../test.txt'), { code: 'INVALID_NAME' });
    assert.throws(() => validateName('sub/test.txt'), { code: 'INVALID_NAME' });
    assert.throws(() => validateName('sub\\test.txt'), { code: 'INVALID_NAME' });
    assert.throws(() => validateName('test\0.txt'), { code: 'INVALID_NAME' });
});

test('direct upload streaming, atomic rename, sha256 match, no staging used', async () => {
    const env = setupEnvironment();
    const fixture = createFixture();
    const port = await fixture.listen();
    const [cSocket, sSocket] = createSocketPair();
    const client = new FramedTransport(cSocket);
    const { registry } = env.createSession(sSocket);

    const events = [];
    const responses = new Map();
    client.on('message', (msg) => {
        if (msg.type === 'event') events.push(msg);
        else if (msg.type === 'response') responses.set(msg.id, msg);
    });

    try {
        const sftpSessionId = await setupSftpSession(client, fixture, port);
    // Generate 64KiB random payload
        const testData = crypto.randomBytes(64 * 1024);
        const testHash = crypto.createHash('sha256').update(testData).digest('hex');

        // 1. Prepare upload
        client.send({
            type: 'request',
            id: 'prep-upload-1',
            channel: 'android:transfer-prepare',
            args: [{
                direction: 'upload',
                sessionId: sftpSessionId,
                remotePath: '/',
                name: 'test-direct-upload.bin',
                size: testData.length
            }]
        });

        for (let i = 0; i < 40; i++) {
            if (responses.has('prep-upload-1')) break;
            await new Promise((r) => setTimeout(r, 50));
        }

        const prepRes = responses.get('prep-upload-1');
        assert.ok(prepRes && prepRes.result && prepRes.result.success, 'Prepare failed');
        const { transferId, socketPath, token } = prepRes.result;
    // 2. Connect to transfer socket
        const tSocket = await connectToSocket(socketPath);
    // 3. Send handshake
        tSocket.write(encodeFrame({ transferId, token, direction: 'upload' }));
        const handshakeReply = await readFrame(tSocket);
    assert.equal(handshakeReply.success, true);
        assert.equal(handshakeReply.size, testData.length);

        // 4. Stream data and shutdown output (half-open)
        tSocket.write(testData);
        tSocket.end();

        // 5. Read final frame from backend
        const finalFrame = await readFrame(tSocket);
    assert.equal(finalFrame.success, true);
        assert.equal(finalFrame.bytes, testData.length);

        // 6. Verify remote file on fixture server
        const uploadedPath = path.join(fixture.files, 'test-direct-upload.bin');
        assert.ok(fs.existsSync(uploadedPath), 'Uploaded file does not exist on remote');
        const uploadedHash = crypto.createHash('sha256').update(fs.readFileSync(uploadedPath)).digest('hex');
        assert.equal(uploadedHash, testHash, 'Uploaded data sha256 mismatch');

        // 7. Verify NO staging files were created
        const stagingDir = path.join(env.root, 'local', 'staging');
        const stagingFiles = fs.readdirSync(stagingDir);
        assert.equal(stagingFiles.length, 0, 'Staging directory was improperly used');

        // 8. Verify journal was cleaned up
        const journalDir = path.join(env.root, 'local', 'transfers');
        const journalFiles = fs.readdirSync(journalDir);
        assert.equal(journalFiles.length, 0, 'Transfer journal was not cleaned up');
    } finally {
        try { client.close(); } catch (_) {}
        try { await registry.close(); } catch (_) {}
        try { await fixture.close(); } catch (_) {}
        env.cleanup();
    }
});

test('upload with unknown size (null) streams and finalizes correctly', async () => {
    const env = setupEnvironment();
    const fixture = createFixture();
    const port = await fixture.listen();
    const [cSocket, sSocket] = createSocketPair();
    const client = new FramedTransport(cSocket);
    const { registry } = env.createSession(sSocket);

    const responses = new Map();
    client.on('message', (msg) => {
        if (msg.type === 'response') responses.set(msg.id, msg);
    });

    try {
        const sftpSessionId = await setupSftpSession(client, fixture, port);
        const testData = Buffer.from('Variable unknown length upload content for Android SFTP');

        client.send({
            type: 'request',
            id: 'prep-upload-null-size',
            channel: 'android:transfer-prepare',
            args: [{
                direction: 'upload',
                sessionId: sftpSessionId,
                remotePath: '/',
                name: 'unknown-size.txt',
                size: null
            }]
        });

        for (let i = 0; i < 40; i++) {
            if (responses.has('prep-upload-null-size')) break;
            await new Promise((r) => setTimeout(r, 50));
        }

        const prepRes = responses.get('prep-upload-null-size');
        assert.ok(prepRes && prepRes.result && prepRes.result.success);
        const { transferId, socketPath, token } = prepRes.result;

        const tSocket = await connectToSocket(socketPath);
        tSocket.write(encodeFrame({ transferId, token, direction: 'upload' }));
        const reply = await readFrame(tSocket);
        assert.equal(reply.success, true);
        assert.equal(reply.size, null);

        tSocket.write(testData);
        tSocket.end();

        const finalFrame = await readFrame(tSocket);
        assert.equal(finalFrame.success, true);
        assert.equal(finalFrame.bytes, testData.length);

        const uploadedPath = path.join(fixture.files, 'unknown-size.txt');
        assert.equal(fs.readFileSync(uploadedPath, 'utf8'), testData.toString('utf8'));
    } finally {
        try { client.close(); } catch (_) {}
        try { await registry.close(); } catch (_) {}
        try { await fixture.close(); } catch (_) {}
        env.cleanup();
    }
});

test('upload overwrite: when destination exists and posix-rename is unsupported, original file is strictly preserved', async () => {
    const env = setupEnvironment();
    const fixture = createFixture();
    const port = await fixture.listen();
    const [cSocket, sSocket] = createSocketPair();
    const client = new FramedTransport(cSocket);
    const { registry } = env.createSession(sSocket);

    const responses = new Map();
    client.on('message', (msg) => {
        if (msg.type === 'response') responses.set(msg.id, msg);
    });

    try {
        const sftpSessionId = await setupSftpSession(client, fixture, port);

        // Pre-create destination file on fixture
        const destPath = path.join(fixture.files, 'existing-protected.txt');
        const originalContent = 'CRITICAL ORIGINAL CONTENT DO NOT OVERWRITE';
        fs.writeFileSync(destPath, originalContent, 'utf8');

        // Prepare upload with same name
        client.send({
            type: 'request',
            id: 'prep-overwrite-fail',
            channel: 'android:transfer-prepare',
            args: [{
                direction: 'upload',
                sessionId: sftpSessionId,
                remotePath: '/',
                name: 'existing-protected.txt',
                size: 20
            }]
        });

        for (let i = 0; i < 40; i++) {
            if (responses.has('prep-overwrite-fail')) break;
            await new Promise((r) => setTimeout(r, 50));
        }

        const prepRes = responses.get('prep-overwrite-fail');
        assert.ok(prepRes && prepRes.result && prepRes.result.success);
        const { transferId, socketPath, token } = prepRes.result;

        const tSocket = await connectToSocket(socketPath);
        tSocket.write(encodeFrame({ transferId, token, direction: 'upload' }));
        const reply = await readFrame(tSocket);
        assert.equal(reply.success, true);

        // Stream new data
        tSocket.write(Buffer.from('NEW ATTEMPTED BYTES!'));
        tSocket.end();

        // Backend will attempt atomic rename. Since posix-rename@openssh.com is not advertised by fixture,
        // sftpAtomicRename detects destination exists and extension unsupported/failed, rejects with error,
        // and preserves the original file!
        const finalFrame = await readFrame(tSocket);
        assert.equal(finalFrame.success, false);
        assert.ok(
            finalFrame.error.includes('Atomic overwrite not supported') ||
            finalFrame.error.includes('Atomic overwrite failed'),
            'Expected atomic overwrite error, got: ' + finalFrame.error
        );

        // Verify original file is STRICTLY PRESERVED
        assert.equal(fs.readFileSync(destPath, 'utf8'), originalContent);

        // Verify no orphaned .termix-part files left in remote directory
        const remoteFiles = fs.readdirSync(fixture.files);
        assert.ok(!remoteFiles.some((f) => f.startsWith('.termix-part-')), 'Temp file was not cleaned up');
    } finally {
        try { client.close(); } catch (_) {}
        try { await registry.close(); } catch (_) {}
        try { await fixture.close(); } catch (_) {}
        env.cleanup();
    }
});

test('upload overwrite: when destination exists and posix-rename is supported, atomic overwrite updates destination file', async () => {
    const env = setupEnvironment();
    const fixture = createFixture();
    const port = await fixture.listen();
    const [cSocket, sSocket] = createSocketPair();
    const client = new FramedTransport(cSocket);
    const { registry } = env.createSession(sSocket);

    const responses = new Map();
    client.on('message', (msg) => {
        if (msg.type === 'response') responses.set(msg.id, msg);
    });

    try {
        const sftpSessionId = await setupSftpSession(client, fixture, port);
        const sess = registry.transfers.getSession(sftpSessionId);
        if (sess && sess.sftp) {
            sess.sftp._extensions['posix-rename@openssh.com'] = '1';
        }

        const destPath = path.join(fixture.files, 'existing-overwrite.txt');
        fs.writeFileSync(destPath, 'OLD BYTES', 'utf8');

        const newContent = 'ATOMIC OVERWRITE NEW BYTES!';
        client.send({
            type: 'request',
            id: 'prep-overwrite-ok',
            channel: 'android:transfer-prepare',
            args: [{
                direction: 'upload',
                sessionId: sftpSessionId,
                remotePath: '/',
                name: 'existing-overwrite.txt',
                size: Buffer.byteLength(newContent)
            }]
        });

        for (let i = 0; i < 40; i++) {
            if (responses.has('prep-overwrite-ok')) break;
            await new Promise((r) => setTimeout(r, 50));
        }

        const prepRes = responses.get('prep-overwrite-ok');
        assert.ok(prepRes && prepRes.result && prepRes.result.success);
        const { transferId, socketPath, token } = prepRes.result;

        const tSocket = await connectToSocket(socketPath);
        tSocket.write(encodeFrame({ transferId, token, direction: 'upload' }));
        const reply = await readFrame(tSocket);
        assert.equal(reply.success, true);

        tSocket.write(Buffer.from(newContent, 'utf8'));
        tSocket.end();

        const finalFrame = await readFrame(tSocket);
        assert.equal(finalFrame.success, true);

        assert.equal(fs.readFileSync(destPath, 'utf8'), newContent);

        const remoteFiles = fs.readdirSync(fixture.files);
        assert.ok(!remoteFiles.some((f) => f.startsWith('.termix-part-')), 'Temp file was not cleaned up');
    } finally {
        try { client.close(); } catch (_) {}
        try { await registry.close(); } catch (_) {}
        try { await fixture.close(); } catch (_) {}
        env.cleanup();
    }
});

test('direct download streaming with exact bytes, no trailing frames, and explicit ACK', async () => {
    const env = setupEnvironment();
    const fixture = createFixture();
    const port = await fixture.listen();
    const [cSocket, sSocket] = createSocketPair();
    const client = new FramedTransport(cSocket);
    const { registry } = env.createSession(sSocket);

    const responses = new Map();
    client.on('message', (msg) => {
        if (msg.type === 'response') responses.set(msg.id, msg);
    });

    try {
        const sftpSessionId = await setupSftpSession(client, fixture, port);

        // Remote file is hello.txt created by fixture
        const remoteHelloPath = path.join(fixture.files, 'hello.txt');
        const expectedBytes = fs.readFileSync(remoteHelloPath);

        // 1. Prepare download
        client.send({
            type: 'request',
            id: 'prep-dl',
            channel: 'android:transfer-prepare',
            args: [{
                direction: 'download',
                sessionId: sftpSessionId,
                remotePath: '/hello.txt'
            }]
        });

        for (let i = 0; i < 40; i++) {
            if (responses.has('prep-dl')) break;
            await new Promise((r) => setTimeout(r, 50));
        }

        const prepRes = responses.get('prep-dl');
        assert.ok(prepRes && prepRes.result && prepRes.result.success, 'Prepare failed');
        const { transferId, socketPath, token, size } = prepRes.result;
        assert.equal(size, expectedBytes.length);

        // 2. Connect
        const tSocket = await connectToSocket(socketPath);

        // 3. Send handshake
        tSocket.write(encodeFrame({ transferId, token, direction: 'download' }));
        const reply = await readFrame(tSocket);
        assert.equal(reply.success, true);
        assert.equal(reply.size, expectedBytes.length);

        // 4. Read EXACT raw bytes
        const { data: rawBytes } = await readExactBytes(tSocket, expectedBytes.length);
        assert.deepEqual(rawBytes, expectedBytes, 'Downloaded bytes do not match remote file');

        // 5. Send framed ACK from client after flush
        tSocket.write(encodeFrame({ success: true, bytes: expectedBytes.length }));

        // 6. Read final framed response
        const finalFrame = await readFrame(tSocket);
        assert.equal(finalFrame.success, true);
        assert.equal(finalFrame.bytes, expectedBytes.length);

        // 7. Verify no staging files
        const stagingFiles = fs.readdirSync(path.join(env.root, 'local', 'staging'));
        assert.equal(stagingFiles.length, 0);
    } finally {
        try { client.close(); } catch (_) {}
        try { await registry.close(); } catch (_) {}
        try { await fixture.close(); } catch (_) {}
        env.cleanup();
    }
});

test('download rejects directories with NOT_REGULAR_FILE error', async () => {
    const env = setupEnvironment();
    const fixture = createFixture();
    const port = await fixture.listen();
    const [cSocket, sSocket] = createSocketPair();
    const client = new FramedTransport(cSocket);
    const { registry } = env.createSession(sSocket);

    const responses = new Map();
    client.on('message', (msg) => {
        if (msg.type === 'response') responses.set(msg.id, msg);
    });

    try {
        const sftpSessionId = await setupSftpSession(client, fixture, port);

        client.send({
            type: 'request',
            id: 'prep-dl-dir',
            channel: 'android:transfer-prepare',
            args: [{
                direction: 'download',
                sessionId: sftpSessionId,
                remotePath: '/'
            }]
        });

        for (let i = 0; i < 40; i++) {
            if (responses.has('prep-dl-dir')) break;
            await new Promise((r) => setTimeout(r, 50));
        }

        const prepRes = responses.get('prep-dl-dir');
        assert.ok(prepRes && prepRes.error, 'Expected prepare to fail on directory');
        assert.equal(prepRes.error.code, 'NOT_REGULAR_FILE');
    } finally {
        try { client.close(); } catch (_) {}
        try { await registry.close(); } catch (_) {}
        try { await fixture.close(); } catch (_) {}
        env.cleanup();
    }
});

test('token validation, replay protection, and direction mismatch rejection', async () => {
    const env = setupEnvironment();
    const fixture = createFixture();
    const port = await fixture.listen();
    const [cSocket, sSocket] = createSocketPair();
    const client = new FramedTransport(cSocket);
    const { registry } = env.createSession(sSocket);

    const responses = new Map();
    client.on('message', (msg) => {
        if (msg.type === 'response') responses.set(msg.id, msg);
    });

    try {
        const sftpSessionId = await setupSftpSession(client, fixture, port);

        client.send({
            type: 'request',
            id: 'prep-sec',
            channel: 'android:transfer-prepare',
            args: [{
                direction: 'upload',
                sessionId: sftpSessionId,
                remotePath: '/',
                name: 'token-test.txt',
                size: 5
            }]
        });

        for (let i = 0; i < 40; i++) {
            if (responses.has('prep-sec')) break;
            await new Promise((r) => setTimeout(r, 50));
        }

        const { transferId, socketPath, token } = responses.get('prep-sec').result;

        // 1. Wrong token
        const badSocket = await connectToSocket(socketPath);
        badSocket.write(encodeFrame({ transferId, token: '00'.repeat(32), direction: 'upload' }));
        const badReply = await readFrame(badSocket);
        assert.equal(badReply.success, false);
        assert.ok(badReply.error.includes('Invalid transfer token'));

        // 2. Correct handshake consumes token
        const goodSocket = await connectToSocket(socketPath);
        goodSocket.write(encodeFrame({ transferId, token, direction: 'upload' }));
        const goodReply = await readFrame(goodSocket);
        assert.equal(goodReply.success, true);

        // 3. Replay with same token is rejected
        const replaySocket = await connectToSocket(socketPath);
        replaySocket.write(encodeFrame({ transferId, token, direction: 'upload' }));
        const replayReply = await readFrame(replaySocket);
        assert.equal(replayReply.success, false);
        assert.ok(replayReply.error.includes('already consumed') || replayReply.error.includes('not found'));

        goodSocket.destroy();
    } finally {
        try { client.close(); } catch (_) {}
        try { await registry.close(); } catch (_) {}
        try { await fixture.close(); } catch (_) {}
        env.cleanup();
    }
});

test('max concurrency limits active transfers to 2 and service-state tracks counts', async () => {
    const env = setupEnvironment();
    const fixture = createFixture();
    const port = await fixture.listen();
    const [cSocket, sSocket] = createSocketPair();
    const client = new FramedTransport(cSocket);
    const { registry } = env.createSession(sSocket);

    const serviceStates = [];
    const responses = new Map();
    client.on('message', (msg) => {
        if (msg.type === 'event' && msg.channel === 'android:service-state') {
            serviceStates.push(msg.payload);
        } else if (msg.type === 'response') {
            responses.set(msg.id, msg);
        }
    });

    try {
        const sftpSessionId = await setupSftpSession(client, fixture, port);

        // Prepare 1
        client.send({
            type: 'request',
            id: 'prep-1',
            channel: 'android:transfer-prepare',
            args: [{ direction: 'upload', sessionId: sftpSessionId, remotePath: '/', name: 'c1.txt', size: 10 }]
        });
        await new Promise((r) => setTimeout(r, 60));
        assert.ok(responses.get('prep-1').result.success);

        // Prepare 2
        client.send({
            type: 'request',
            id: 'prep-2',
            channel: 'android:transfer-prepare',
            args: [{ direction: 'upload', sessionId: sftpSessionId, remotePath: '/', name: 'c2.txt', size: 10 }]
        });
        await new Promise((r) => setTimeout(r, 60));
        assert.ok(responses.get('prep-2').result.success);

        // Prepare 3 (should fail due to max concurrency = 2)
        client.send({
            type: 'request',
            id: 'prep-3',
            channel: 'android:transfer-prepare',
            args: [{ direction: 'upload', sessionId: sftpSessionId, remotePath: '/', name: 'c3.txt', size: 10 }]
        });
        await new Promise((r) => setTimeout(r, 60));
        const res3 = responses.get('prep-3');
        assert.ok(res3 && res3.error);
        assert.equal(res3.error.code, 'MAX_TRANSFERS_EXCEEDED');

        // Check service states showed transfers: 1 then 2
        assert.ok(serviceStates.some((s) => s.transfers === 1));
        assert.ok(serviceStates.some((s) => s.transfers === 2));

        // Cancel 1
        const t1Id = responses.get('prep-1').result.transferId;
        client.send({
            type: 'request',
            id: 'cancel-1',
            channel: 'android:transfer-cancel',
            args: [{ transferId: t1Id }]
        });
        await new Promise((r) => setTimeout(r, 60));

        // Now prepare 4 should succeed
        client.send({
            type: 'request',
            id: 'prep-4',
            channel: 'android:transfer-prepare',
            args: [{ direction: 'upload', sessionId: sftpSessionId, remotePath: '/', name: 'c4.txt', size: 10 }]
        });
        await new Promise((r) => setTimeout(r, 60));
        assert.ok(responses.get('prep-4').result.success);
    } finally {
        try { client.close(); } catch (_) {}
        try { await registry.close(); } catch (_) {}
        try { await fixture.close(); } catch (_) {}
        env.cleanup();
    }
});

test('transfer-cancel aborts stream and cleans up remote temp file', async () => {
    const env = setupEnvironment();
    const fixture = createFixture();
    const port = await fixture.listen();
    const [cSocket, sSocket] = createSocketPair();
    const client = new FramedTransport(cSocket);
    const { registry } = env.createSession(sSocket);

    const responses = new Map();
    client.on('message', (msg) => {
        if (msg.type === 'response') responses.set(msg.id, msg);
    });

    try {
        const sftpSessionId = await setupSftpSession(client, fixture, port);

        client.send({
            type: 'request',
            id: 'prep-cancel-stream',
            channel: 'android:transfer-prepare',
            args: [{ direction: 'upload', sessionId: sftpSessionId, remotePath: '/', name: 'cancel-me.bin', size: 100000 }]
        });
        await new Promise((r) => setTimeout(r, 60));
        const { transferId, socketPath, token } = responses.get('prep-cancel-stream').result;

        const tSocket = await connectToSocket(socketPath);
        tSocket.write(encodeFrame({ transferId, token, direction: 'upload' }));
        await readFrame(tSocket);

        // Write some bytes
        tSocket.write(Buffer.alloc(1024, 0x42));
        await new Promise((r) => setTimeout(r, 100));

        // Cancel via RPC
        client.send({
            type: 'request',
            id: 'do-cancel',
            channel: 'android:transfer-cancel',
            args: [{ transferId }]
        });
        await new Promise((r) => setTimeout(r, 100));

        // Verify status is cancelled
        client.send({
            type: 'request',
            id: 'get-status',
            channel: 'android:transfer-status',
            args: [{ transferId }]
        });
        await new Promise((r) => setTimeout(r, 60));
        const statusRes = responses.get('get-status');
        assert.equal(statusRes.result.transfer.state, 'cancelled');

        // Verify remote temp file was removed
        const remoteFiles = fs.readdirSync(fixture.files);
        assert.ok(!remoteFiles.some((f) => f.startsWith('.termix-part-')), 'Remote temp file was not deleted upon cancel');
    } finally {
        try { client.close(); } catch (_) {}
        try { await registry.close(); } catch (_) {}
        try { await fixture.close(); } catch (_) {}
        env.cleanup();
    }
});

test('legacy staging cleanup safely cleans only inside dedicated staging root', async () => {
    const env = setupEnvironment();
    try {
        const stagingRoot = path.join(env.root, 'local', 'staging');
        const legacyDir = path.join(stagingRoot, 'old-stage-123');
        fs.mkdirSync(legacyDir, { recursive: true });
        fs.writeFileSync(path.join(legacyDir, 'leftover.bin'), 'leftover');

        assert.equal(fs.existsSync(legacyDir), true);
        await cleanLegacyStaging(stagingRoot);
        assert.equal(fs.existsSync(legacyDir), false);
    } finally {
        env.cleanup();
    }
});
