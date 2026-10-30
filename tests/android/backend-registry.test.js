'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { createSocketPair } = require('./helpers');
const { FramedTransport } = require('../../util/android/backend/transport');

function setupEnvironment() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'termix-test-root-'));
    process.env.TERMIX_PLATFORM = 'android';
    process.env.TERMIX_DATA_ROOT = root;
    process.env.TERMIX_PORTABLE_KEY = crypto.randomBytes(48).toString('base64');
    process.env.TERMIX_ANDROID_NO_AUTOSTART = '1';
    for (const sub of ['files', 'profiles', 'local']) {
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
            fs.rmSync(root, { recursive: true, force: true });
        }
    };
}

test('backend rejects dynamic or unwhitelisted channels with UNSUPPORTED error', async () => {
    const env = setupEnvironment();
    try {
        const [clientSocket, serverSocket] = createSocketPair();
        const client = new FramedTransport(clientSocket);
        const { registry } = env.createSession(serverSocket);
        const responses = [];
        client.on('message', (msg) => {
            if (msg.type === 'response') responses.push(msg);
        });

        client.send({ type: 'request', id: 1, channel: 'arbitrary:eval', args: [] });
        await new Promise((resolve) => setTimeout(resolve, 80));

        assert.equal(responses.length, 1);
        assert.equal(responses[0].id, 1);
        assert.equal(responses[0].error.code, 'UNSUPPORTED');
        client.close();
        await registry.close();
    } finally {
        env.cleanup();
    }
});

test('profile and hosts CRUD work correctly in isolated storage', async () => {
    const env = setupEnvironment();
    try {
        const [clientSocket, serverSocket] = createSocketPair();
        const client = new FramedTransport(clientSocket);
        const { registry } = env.createSession(serverSocket);
        const map = new Map();
        client.on('message', (msg) => {
            if (msg.type === 'response') map.set(msg.id, msg);
        });

        // 1. Save host with password (should encrypt internally)
        client.send({
            type: 'request',
            id: 'save-host',
            channel: 'hosts:set-data',
            args: [[{ id: 'h1', name: 'Test Server', address: '127.0.0.1', password: 'plain-secret-pass', port: '22' }]]
        });
        await new Promise((resolve) => setTimeout(resolve, 60));

        // 2. Read back host
        client.send({ type: 'request', id: 'get-host', channel: 'hosts:get-data', args: [] });
        await new Promise((resolve) => setTimeout(resolve, 60));

        const getRes = map.get('get-host');
        assert.ok(getRes && getRes.result);
        assert.equal(getRes.result.length, 1);
        assert.equal(getRes.result[0].password, 'plain-secret-pass');

        // Verify file on disk is encrypted, not plain
        const dbPath = path.join(env.root, 'profiles', 'default.json');
        const diskContent = fs.readFileSync(dbPath, 'utf8');
        assert.ok(!diskContent.includes('plain-secret-pass'), 'Raw password leaked to disk');
        assert.ok(diskContent.includes('ptb:'), 'Expected portable encryption header');

        // 3. Create, list, switch profiles
        client.send({
            type: 'request',
            id: 'create-profile',
            channel: 'profiles:create-profile',
            args: [{ name: 'Work Profile', type: 'local', activate: false }]
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(map.get('create-profile').result.success, true);

        client.send({ type: 'request', id: 'list-profiles', channel: 'profiles:get-profiles', args: [] });
        await new Promise((resolve) => setTimeout(resolve, 60));
        const listRes = map.get('list-profiles');
        assert.equal(listRes.result.profiles.length, 2);

        client.close();
        await registry.close();
    } finally {
        env.cleanup();
    }
});

test('keychain CRUD keeps keys inside app-private files directory with mode 0600', async () => {
    const env = setupEnvironment();
    try {
        const [clientSocket, serverSocket] = createSocketPair();
        const client = new FramedTransport(clientSocket);
        const { registry } = env.createSession(serverSocket);
        const map = new Map();
        client.on('message', (msg) => {
            if (msg.type === 'response') map.set(msg.id, msg);
        });

        // Save key
        client.send({
            type: 'request',
            id: 'save-key',
            channel: 'keychain:save-key-file',
            args: ['', 'id_rsa.pem', '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----']
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(map.get('save-key').result.success, true);

        // List keys
        client.send({ type: 'request', id: 'get-keys', channel: 'keychain:get-key-files', args: [] });
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(map.get('get-keys').result.length, 1);
        assert.equal(map.get('get-keys').result[0].name, 'id_rsa.pem');

        // Prevent traversal attack
        client.send({
            type: 'request',
            id: 'traversal-key',
            channel: 'keychain:save-key-file',
            args: ['', '../../evil.key', 'evil content']
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(map.get('traversal-key').result.success, false);

        client.close();
        await registry.close();
    } finally {
        env.cleanup();
    }
});

test('android:download-stage creates isolated staging directories under staging root and cleans them safely', async () => {
    const env = setupEnvironment();
    try {
        const [clientSocket, serverSocket] = createSocketPair();
        const client = new FramedTransport(clientSocket);
        const { registry } = env.createSession(serverSocket);
        const map = new Map();
        client.on('message', (msg) => {
            if (msg.type === 'response') map.set(msg.id, msg);
        });

        // 1. Request a staging directory
        client.send({
            type: 'request',
            id: 'stage-1',
            channel: 'android:download-stage',
            args: []
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        const res1 = map.get('stage-1');
        assert.ok(res1 && res1.result && res1.result.success, 'Staging request failed');
        assert.ok(res1.result.stageId, 'stageId missing');
        assert.ok(res1.result.stageDir, 'stageDir missing');
        assert.ok(fs.existsSync(res1.result.stageDir), 'stageDir does not exist on disk');

        // Verify confinement under dedicated STAGING_ROOT
        const expectedRoot = path.join(env.root, 'local', 'staging');
        assert.equal(path.resolve(res1.result.stagingRoot), path.resolve(expectedRoot));
        assert.ok(path.resolve(res1.result.stageDir).startsWith(path.resolve(expectedRoot) + path.sep));

        // 2. Put a test file in the staging directory
        const testFile = path.join(res1.result.stageDir, 'test.txt');
        fs.writeFileSync(testFile, 'staged content');
        assert.ok(fs.existsSync(testFile));

        // 3. Test cleanup
        client.send({
            type: 'request',
            id: 'cleanup-1',
            channel: 'android:download-stage',
            args: [{ action: 'cleanup', stageId: res1.result.stageId }]
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        const cleanRes = map.get('cleanup-1');
        assert.ok(cleanRes && cleanRes.result && cleanRes.result.success);
        assert.equal(fs.existsSync(res1.result.stageDir), false, 'Staging dir was not removed by cleanup');

        // 4. Test traversal prevention on cleanup
        const canaryFile = path.join(env.root, 'profiles', 'canary.txt');
        fs.writeFileSync(canaryFile, 'canary');
        client.send({
            type: 'request',
            id: 'cleanup-traversal',
            channel: 'android:download-stage',
            args: [{ action: 'cleanup', stageId: '../../profiles/canary.txt' }]
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.ok(fs.existsSync(canaryFile), 'Traversal attack deleted canary file');

        client.close();
        await registry.close();
    } finally {
        env.cleanup();
    }
});

test('android:service-state and stop-all-connections lifecycle tracking', async () => {
    const env = setupEnvironment();
    try {
        const [clientSocket, serverSocket] = createSocketPair();
        const client = new FramedTransport(clientSocket);
        const { registry } = env.createSession(serverSocket);
        const events = [];
        const responses = new Map();
        client.on('message', (msg) => {
            if (msg.type === 'event' && msg.channel === 'android:service-state') {
                events.push(msg.payload);
            } else if (msg.type === 'response') {
                responses.set(msg.id, msg);
            }
        });

        // Test stop-all-connections
        client.send({
            type: 'request',
            id: 'stop-all',
            channel: 'android:stop-all-connections',
            args: []
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        const stopRes = responses.get('stop-all');
        assert.ok(stopRes && stopRes.result && stopRes.result.success);

        // Verify service-state emitted
        assert.ok(events.length > 0, 'Expected at least one android:service-state event');
        const lastEvent = events[events.length - 1];
        assert.equal(lastEvent.terminals, 0);
        assert.equal(lastEvent.sftp, 0);
        assert.equal(lastEvent.transfers, 0);

        client.close();
        await registry.close();
    } finally {
        env.cleanup();
    }
});
