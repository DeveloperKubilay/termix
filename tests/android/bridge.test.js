'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('native pickers (export-file, import-key, pick-upload-file) wait without timeout and handle cancellation', async () => {
    const frames = [];
    const timers = [];
    const window = {
        termixNative: { postMessage: data => frames.push(JSON.parse(data)) },
        setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
        clearTimeout() {}
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../public/android/bridge.js'), 'utf8'), { window, console });
    window.termixNative.onmessage({ data: JSON.stringify({ type: 'ready', protocol: 1, capabilities: {} }) });

    // 1. keyboard has regular timeout
    const initialTimers = timers.length;
    const keyboard = window.TermixAndroid.showKeyboard();
    await Promise.resolve();
    assert.equal(timers.length, initialTimers + 1, 'Standard requests must register a timeout');
    const keyboardFrame = frames.at(-1);
    assert.equal(keyboardFrame.channel, 'native:show-keyboard');
    window.termixNative.onmessage({ data: JSON.stringify({ type: 'response', id: keyboardFrame.id, result: null }) });
    await keyboard;

    // 2. native:export-file exempt
    let timerCount = timers.length;
    const exported = window.TermixAndroid.invoke('native:export-file', { localPath: '/staging/example.txt' });
    await Promise.resolve();
    assert.equal(timers.length, timerCount, 'native:export-file must not register a timeout');
    const exportFrame = frames.at(-1);
    window.termixNative.onmessage({ data: JSON.stringify({ type: 'response', id: exportFrame.id, result: { cancelled: true } }) });
    assert.equal((await exported).cancelled, true);

    // 3. native:import-key exempt and benign cancellation
    timerCount = timers.length;
    const keyImport = window.TermixAndroid.invoke('native:import-key');
    await Promise.resolve();
    assert.equal(timers.length, timerCount, 'native:import-key must not register a timeout');
    const importKeyFrame = frames.at(-1);
    assert.equal(importKeyFrame.channel, 'native:import-key');
    window.termixNative.onmessage({ data: JSON.stringify({ type: 'response', id: importKeyFrame.id, result: { cancelled: true } }) });
    const importRes = await keyImport;
    assert.equal(importRes.cancelled, true);

    // 4. native:pick-upload-file exempt and benign cancellation
    timerCount = timers.length;
    const pickUpload = window.TermixAndroid.invoke('native:pick-upload-file');
    await Promise.resolve();
    assert.equal(timers.length, timerCount, 'native:pick-upload-file must not register a timeout');
    const pickUploadFrame = frames.at(-1);
    assert.equal(pickUploadFrame.channel, 'native:pick-upload-file');
    window.termixNative.onmessage({ data: JSON.stringify({ type: 'response', id: pickUploadFrame.id, result: { cancelled: true } }) });
    const uploadRes = await pickUpload;
    assert.equal(uploadRes.cancelled, true);

    // 5. native:create-download-document exempt
    timerCount = timers.length;
    const createDoc = window.TermixAndroid.invoke('native:create-download-document', { name: 'test.txt' });
    await Promise.resolve();
    assert.equal(timers.length, timerCount, 'native:create-download-document must not register a timeout');
    const createDocFrame = frames.at(-1);
    assert.equal(createDocFrame.channel, 'native:create-download-document');
    window.termixNative.onmessage({ data: JSON.stringify({ type: 'response', id: createDocFrame.id, result: { success: true, handle: 'doc-dl-123' } }) });
    const createDocRes = await createDoc;
    assert.equal(createDocRes.handle, 'doc-dl-123');

    // 6. native:transfer-run exempt
    timerCount = timers.length;
    const transferRun = window.TermixAndroid.invoke('native:transfer-run', { handle: 'doc-dl-123' });
    await Promise.resolve();
    assert.equal(timers.length, timerCount, 'native:transfer-run must not register a timeout');
    const transferRunFrame = frames.at(-1);
    assert.equal(transferRunFrame.channel, 'native:transfer-run');
    window.termixNative.onmessage({ data: JSON.stringify({ type: 'response', id: transferRunFrame.id, result: { success: true, bytes: 4096 } }) });
    const transferRunRes = await transferRun;
    assert.equal(transferRunRes.bytes, 4096);
});

test('android:transfer-progress event is delivered to electronAPI listeners', async () => {
    const frames = [];
    const window = {
        termixNative: { postMessage: data => frames.push(JSON.parse(data)) },
        setTimeout: () => 1,
        clearTimeout() {}
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../public/android/bridge.js'), 'utf8'), { window, console });
    window.termixNative.onmessage({ data: JSON.stringify({ type: 'ready', protocol: 1, capabilities: {} }) });

    const progressEvents = [];
    window.electronAPI.on('android:transfer-progress', (_event, payload) => {
        progressEvents.push(payload);
    });

    window.termixNative.onmessage({
        data: JSON.stringify({
            type: 'event',
            channel: 'android:transfer-progress',
            payload: { transferId: 'tx-1', direction: 'download', bytes: 1024, totalBytes: 2048, state: 'transferring' }
        })
    });

    assert.equal(progressEvents.length, 1);
    assert.equal(progressEvents[0].transferId, 'tx-1');
    assert.equal(progressEvents[0].bytes, 1024);
});

test('keychain deleteKeyFile invokes keychain:delete-key-file', async () => {
    const frames = [];
    const window = {
        termixNative: { postMessage: data => frames.push(JSON.parse(data)) },
        setTimeout: () => 1,
        clearTimeout() {}
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../public/android/bridge.js'), 'utf8'), { window, console });
    window.termixNative.onmessage({ data: JSON.stringify({ type: 'ready', protocol: 1, capabilities: {} }) });

    assert.equal(typeof window.electronAPI.keychain.deleteKeyFile, 'function');

    // Test deleteKeyFile
    const p1 = window.electronAPI.keychain.deleteKeyFile('my-key.pem');
    await Promise.resolve();
    const frame1 = frames.at(-1);
    assert.equal(frame1.channel, 'keychain:delete-key-file');
    assert.deepEqual(frame1.args, ['my-key.pem']);
    window.termixNative.onmessage({ data: JSON.stringify({ type: 'response', id: frame1.id, result: { success: true } }) });
    const res1 = await p1;
    assert.equal(res1.success, true);
});
