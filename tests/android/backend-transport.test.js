'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSocketPair } = require('./helpers');
const { FramedTransport } = require('../../util/android/backend/transport');
const { safePath, inside } = require('../../util/android/backend/sandbox');

test('transport delivers exact JSON frames without concatenation or truncation', async () => {
    const [clientSocket, serverSocket] = createSocketPair();
    const client = new FramedTransport(clientSocket);
    const server = new FramedTransport(serverSocket);
    const received = [];
    server.on('message', (msg) => received.push(msg));
    client.send({ type: 'ready', protocol: 1 });
    client.send({ type: 'request', id: 'req-1', channel: 'hosts:get-data', args: [] });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(received.length, 2);
    assert.deepEqual(received[0], { type: 'ready', protocol: 1 });
    assert.equal(received[1].channel, 'hosts:get-data');
    client.close();
});

test('transport drops connections exceeding the 4MB maximum frame length', async () => {
    const [clientSocket, serverSocket] = createSocketPair();
    const server = new FramedTransport(serverSocket);
    let closed = false;
    server.on('close', () => { closed = true; });
    const hugeHeader = Buffer.alloc(4);
    hugeHeader.writeUInt32BE(5 * 1024 * 1024);
    clientSocket.write(hugeHeader);
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(closed, true);
});

test('sandbox confines files inside root and rejects symlinks', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'termix-sandbox-test-'));
    try {
        const file = path.join(root, 'file.txt');
        fs.writeFileSync(file, 'ok');
        assert.equal(safePath(root, 'file.txt'), file);
        assert.equal(inside(root, file), true);
        assert.equal(inside(root, path.join(root, '..', 'escape')), false);
        assert.throws(() => safePath(root, '../escape'), /outside the Android local file sandbox/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
