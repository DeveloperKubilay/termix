'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'termix-test-sftp-'));
process.env.TERMIX_PLATFORM = 'android';
process.env.TERMIX_DATA_ROOT = root;
process.env.TERMIX_PORTABLE_KEY = crypto.randomBytes(48).toString('base64');
process.env.TERMIX_ANDROID_NO_AUTOSTART = '1';
for (const sub of ['files', 'profiles', 'local']) {
    fs.mkdirSync(path.join(root, sub), { recursive: true, mode: 0o700 });
}

const { createSocketPair } = require('./helpers');
const { createSession } = require('../../util/android/backend/bootstrap');
const { FramedTransport } = require('../../util/android/backend/transport');
const { createFixture } = require('./fixture-server');

test.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

test('real SSH terminal and SFTP with host trust work against isolated fixture', async () => {
    const fixture = createFixture();
    const port = await fixture.listen();
    const [clientSocket, serverSocket] = createSocketPair();
    const client = new FramedTransport(clientSocket);
    const { registry } = createSession(serverSocket);
    const events = [];
    const responses = new Map();

    client.on('message', (msg) => {
        if (msg.type === 'event') events.push(msg);
        else if (msg.type === 'response') responses.set(msg.id, msg);
    });

    try {
        // 1. Initiate SSH terminal connection
        client.send({
            type: 'request',
            id: 'conn-1',
            channel: 'connection:connect',
            args: [{
                address: '127.0.0.1',
                port,
                username: 'termix',
                password: fixture.password,
                protocol: 'SSH'
            }, { clientRequestId: 'req-ssh-1' }]
        });

        // First use pins the disposable fixture automatically, without a prompt.
        let connRes = null;
        for (let i = 0; i < 40; i++) {
            connRes = responses.get('conn-1');
            if (connRes) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.ok(connRes && connRes.result, 'SSH connection failed');
        assert.equal(connRes.result.status, 'connected');
        assert.equal(events.some(event => event.channel === 'android:host-key'), false);
        const sessionId = connRes.result.sessionId;

        // 5. Send terminal input and verify data echoed
        client.send({
            type: 'send',
            channel: 'term-input',
            payload: { sessionId, data: 'echo android-ok\n' }
        });

        let sawEcho = false;
        for (let i = 0; i < 40; i++) {
            sawEcho = events.some((e) => e.channel === 'term-data' && e.payload.sessionId === sessionId && e.payload.data.includes('android-ok'));
            if (sawEcho) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        assert.equal(sawEcho, true, 'Terminal output echo not received');

        // 6. Connect SFTP using the now-trusted host
        // Save host to DB first
        client.send({
            type: 'request',
            id: 'save-sftp-host',
            channel: 'hosts:set-data',
            args: [[{ id: 'fix-1', name: 'Fixture Host', address: '127.0.0.1', port: String(port), username: 'termix', password: fixture.password, protocol: 'SSH' }]]
        });
        await new Promise((resolve) => setTimeout(resolve, 60));

        client.send({
            type: 'request',
            id: 'sftp-connect-1',
            channel: 'sftp:connect',
            args: ['fix-1']
        });
        for (let i = 0; i < 40; i++) {
            if (responses.has('sftp-connect-1')) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const sftpConn = responses.get('sftp-connect-1');
        assert.ok(sftpConn && sftpConn.result && sftpConn.result.success, 'SFTP connect failed');
        const sftpSessionId = sftpConn.result.sessionId;

        // 7. List remote directory via SFTP
        client.send({
            type: 'request',
            id: 'sftp-list',
            channel: 'sftp:list-directory',
            args: [{ side: 'remote', sessionId: sftpSessionId, path: '/' }]
        });
        for (let i = 0; i < 40; i++) {
            if (responses.has('sftp-list')) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const listRes = responses.get('sftp-list');
        assert.ok(listRes && listRes.result && listRes.result.success);
        assert.ok(listRes.result.entries.some((e) => e.name === 'hello.txt'));

        // 8. Test SFTP rename / move item
        client.send({
            type: 'request',
            id: 'sftp-rename',
            channel: 'sftp:rename-item',
            args: [{
                side: 'remote',
                sessionId: sftpSessionId,
                path: '/hello.txt',
                newName: 'moved-hello.txt'
            }]
        });
        for (let i = 0; i < 40; i++) {
            if (responses.has('sftp-rename')) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const renameRes = responses.get('sftp-rename');
        assert.ok(renameRes && renameRes.result && renameRes.result.success, 'SFTP rename failed');
        assert.equal(renameRes.result.renamed, true);

        // Verify moved file exists in directory listing
        client.send({
            type: 'request',
            id: 'sftp-list-after-rename',
            channel: 'sftp:list-directory',
            args: [{ side: 'remote', sessionId: sftpSessionId, path: '/' }]
        });
        for (let i = 0; i < 40; i++) {
            if (responses.has('sftp-list-after-rename')) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const listAfterRename = responses.get('sftp-list-after-rename');
        assert.ok(listAfterRename && listAfterRename.result && listAfterRename.result.success);
        assert.ok(listAfterRename.result.entries.some((e) => e.name === 'moved-hello.txt'));
        assert.ok(!listAfterRename.result.entries.some((e) => e.name === 'hello.txt'));

        // 8b. Test server-side cross-directory move via destinationPath
        client.send({
            type: 'request',
            id: 'sftp-mkdir-sub',
            channel: 'sftp:create-directory',
            args: [{ side: 'remote', sessionId: sftpSessionId, parentPath: '/', name: 'sub' }]
        });
        for (let i = 0; i < 40; i++) {
            if (responses.has('sftp-mkdir-sub')) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }

        client.send({
            type: 'request',
            id: 'sftp-move-destpath',
            channel: 'sftp:rename-item',
            args: [{
                side: 'remote',
                sessionId: sftpSessionId,
                path: '/moved-hello.txt',
                destinationPath: '/sub/server-moved.txt'
            }]
        });
        for (let i = 0; i < 40; i++) {
            if (responses.has('sftp-move-destpath')) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const moveDestRes = responses.get('sftp-move-destpath');
        assert.ok(moveDestRes && moveDestRes.result && moveDestRes.result.success, 'SFTP server-side move failed');
        assert.equal(moveDestRes.result.newPath, '/sub/server-moved.txt');

        // Move back to root
        client.send({
            type: 'request',
            id: 'sftp-move-back',
            channel: 'sftp:rename-item',
            args: [{
                side: 'remote',
                sessionId: sftpSessionId,
                path: '/sub/server-moved.txt',
                destinationPath: '/moved-hello.txt'
            }]
        });
        for (let i = 0; i < 40; i++) {
            if (responses.has('sftp-move-back')) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const moveBackRes = responses.get('sftp-move-back');
        assert.ok(moveBackRes && moveBackRes.result && moveBackRes.result.success, 'SFTP server-side move back failed');
        assert.equal(moveBackRes.result.newPath, '/moved-hello.txt');

        // 9. Test streaming remote-to-local staging copy (copyItems)
        const stagingDir = path.join(root, 'local', 'staging', 'fixture-stage');
        fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
        client.send({
            type: 'request',
            id: 'sftp-stage-copy',
            channel: 'sftp:copy-items',
            args: [{
                sourceSide: 'remote',
                destinationSide: 'local',
                sourceSessionId: sftpSessionId,
                destinationSessionId: null,
                destinationPath: stagingDir,
                items: [{ path: '/moved-hello.txt', isDirectory: false }],
                conflictPolicy: 'overwrite'
            }]
        });
        for (let i = 0; i < 40; i++) {
            if (responses.has('sftp-stage-copy')) break;
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        const copyRes = responses.get('sftp-stage-copy');
        assert.ok(copyRes && copyRes.result && copyRes.result.success, 'Remote to staging copy failed');
        const copiedFile = path.join(stagingDir, 'moved-hello.txt');
        assert.ok(fs.existsSync(copiedFile), 'Staged file does not exist locally');
        assert.equal(fs.readFileSync(copiedFile, 'utf8'), 'Termix fixture — Türkçe ✅\n');

        // 10. Clean up staging
        fs.rmSync(stagingDir, { recursive: true, force: true });
        assert.equal(fs.existsSync(stagingDir), false);

        // 11. Clean up sessions
        client.send({ type: 'send', channel: 'term-close', payload: { sessionId } });
        client.send({ type: 'request', id: 'sftp-disc', channel: 'sftp:disconnect', args: [sftpSessionId] });
        await new Promise((resolve) => setTimeout(resolve, 80));

        client.close();
        await registry.close();
    } finally {
        await fixture.close();
    }
});
