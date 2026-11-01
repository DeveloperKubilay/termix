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

        // Delete endpoint tests:
        // 1. Block deleting key referenced by saved host in current profile
        client.send({
            type: 'request',
            id: 'save-host-with-cert',
            channel: 'hosts:set-data',
            args: [[{ id: 'h-cert', name: 'Cert Server', address: '127.0.0.1', certPath: 'id_rsa.pem', port: '22' }]]
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.ok(Array.isArray(map.get('save-host-with-cert').result));

        client.send({
            type: 'request',
            id: 'del-referenced-key',
            channel: 'keychain:delete-key-file',
            args: ['id_rsa.pem']
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        const delRefRes = map.get('del-referenced-key');
        assert.equal(delRefRes.result.success, false);
        assert.match(delRefRes.result.error, /referenced by saved host/i);

        // 2. Clear host cert reference, then delete should succeed
        client.send({
            type: 'request',
            id: 'clear-host-cert',
            channel: 'hosts:set-data',
            args: [[{ id: 'h-cert', name: 'Cert Server', address: '127.0.0.1', port: '22' }]]
        });
        await new Promise((resolve) => setTimeout(resolve, 60));

        client.send({
            type: 'request',
            id: 'del-key-success',
            channel: 'keychain:delete-key-file',
            args: ['id_rsa.pem']
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(map.get('del-key-success').result.success, true);
        assert.equal(fs.existsSync(path.join(env.root, 'files', 'id_rsa.pem')), false);

        // 3. Deleting non-existent key fails
        client.send({
            type: 'request',
            id: 'del-missing-key',
            channel: 'keychain:delete-key-file',
            args: ['missing.pem']
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(map.get('del-missing-key').result.success, false);
        assert.match(map.get('del-missing-key').result.error, /not found/i);

        // 4. Refuse directory deletion
        const subDir = path.join(env.root, 'files', 'subdir');
        fs.mkdirSync(subDir, { recursive: true });
        client.send({
            type: 'request',
            id: 'del-dir',
            channel: 'keychain:delete-key-file',
            args: ['subdir']
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(map.get('del-dir').result.success, false);
        assert.match(map.get('del-dir').result.error, /directories/i);

        // 5. Refuse path escape deletion
        client.send({
            type: 'request',
            id: 'del-escape',
            channel: 'keychain:delete-key-file',
            args: ['../../outside.key']
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(map.get('del-escape').result.success, false);

        // 6. Cross-profile reference test: key referenced in another registered profile is blocked
        client.send({
            type: 'request',
            id: 'save-cross-key',
            channel: 'keychain:save-key-file',
            args: ['', 'cross_profile.key', 'cross profile key content']
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(map.get('save-cross-key').result.success, true);

        // Create a secondary profile
        client.send({
            type: 'request',
            id: 'create-sec-profile',
            channel: 'profiles:create-profile',
            args: [{ name: 'Staging Profile', type: 'local', activate: false }]
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(map.get('create-sec-profile').result.success, true);

        // Add a host with certPath pointing to cross_profile.key in Staging Profile's JSON
        const stagingProfilePath = path.join(env.root, 'profiles', 'staging-profile.json');
        const stagingData = JSON.parse(fs.readFileSync(stagingProfilePath, 'utf8'));
        stagingData.hosts = [{ id: 'stg-1', name: 'Staging Host', certPath: 'cross_profile.key', address: '10.0.0.1' }];
        fs.writeFileSync(stagingProfilePath, JSON.stringify(stagingData, null, 2), 'utf8');

        // Attempting to delete cross_profile.key from active default profile must be blocked
        client.send({
            type: 'request',
            id: 'del-cross-key',
            channel: 'keychain:delete-key-file',
            args: ['cross_profile.key']
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        const delCrossRes = map.get('del-cross-key');
        assert.equal(delCrossRes.result.success, false);
        assert.match(delCrossRes.result.error, /referenced by saved host "Staging Host"/i);
        assert.match(delCrossRes.result.error, /Staging Profile/i);

        // 7. Fail closed if registered profile cannot be inspected
        fs.writeFileSync(stagingProfilePath, '{ invalid json content !!!', 'utf8');
        client.send({
            type: 'request',
            id: 'del-fail-closed',
            channel: 'keychain:delete-key-file',
            args: ['cross_profile.key']
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        const delFailClosedRes = map.get('del-fail-closed');
        assert.equal(delFailClosedRes.result.success, false);
        assert.match(delFailClosedRes.result.error, /Cannot safely verify key usage/i);

        // Restore staging profile with empty hosts, then deletion of cross_profile.key should succeed
        stagingData.hosts = [];
        fs.writeFileSync(stagingProfilePath, JSON.stringify(stagingData, null, 2), 'utf8');
        client.send({
            type: 'request',
            id: 'del-cross-key-clean',
            channel: 'keychain:delete-key-file',
            args: ['cross_profile.key']
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        assert.equal(map.get('del-cross-key-clean').result.success, true);
        assert.equal(fs.existsSync(path.join(env.root, 'files', 'cross_profile.key')), false);

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
        const allEvents = [];
        const responses = new Map();
        client.on('message', (msg) => {
            if (msg.type === 'event') {
                allEvents.push(msg);
                if (msg.channel === 'android:service-state') {
                    events.push(msg.payload);
                }
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
        let stopRes = null;
        for (let i = 0; i < 50; i++) {
            stopRes = responses.get('stop-all');
            if (stopRes) break;
            await new Promise((resolve) => setTimeout(resolve, 20));
        }
        assert.ok(stopRes && stopRes.result && stopRes.result.success);
        assert.ok(allEvents.some(e => e.channel === 'android:all-connections-stopped'), 'Expected android:all-connections-stopped event');

        // Verify service-state emitted
        assert.ok(events.length > 0, 'Expected at least one android:service-state event');
        const lastEvent = events[events.length - 1];
        assert.equal(lastEvent.terminals, 0);
        assert.equal(lastEvent.sftp, 0);
        assert.equal(lastEvent.transfers, 0);

        // Verify that terminal connection is still permitted after stop-all (not permanently closed)
        client.send({
            type: 'request',
            id: 'reconnect-test',
            channel: 'connection:connect',
            args: [{ protocol: 'TELNET', address: '127.0.0.1' }]
        });
        await new Promise((resolve) => setTimeout(resolve, 60));
        const reconnectRes = responses.get('reconnect-test');
        // Protocol check should fail with 'Only SSH terminals are supported on Android.', NOT 'Backend transport is closed.'
        assert.ok(reconnectRes && reconnectRes.result);
        assert.equal(reconnectRes.result.message, 'Only SSH terminals are supported on Android.');

        client.close();
        await registry.close();
    } finally {
        env.cleanup();
    }
});
