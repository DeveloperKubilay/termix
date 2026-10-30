'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('keyboard is exposed and native export waits for picker instead of timing out', async () => {
    const frames = [];
    const timers = [];
    const window = {
        termixNative: { postMessage: data => frames.push(JSON.parse(data)) },
        setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; },
        clearTimeout() {}
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../public/android/bridge.js'), 'utf8'), { window, console });
    window.termixNative.onmessage({ data: JSON.stringify({ type: 'ready', protocol: 1, capabilities: {} }) });
    const keyboard = window.TermixAndroid.showKeyboard();
    await Promise.resolve();
    const keyboardFrame = frames.at(-1);
    assert.equal(keyboardFrame.channel, 'native:show-keyboard');
    window.termixNative.onmessage({ data: JSON.stringify({ type: 'response', id: keyboardFrame.id, result: null }) });
    await keyboard;
    const timerCount = timers.length;
    const exported = window.TermixAndroid.invoke('native:export-file', { localPath: '/staging/example.txt' });
    await Promise.resolve();
    assert.equal(timers.length, timerCount, 'Document picker must not inherit the RPC timeout');
    const exportFrame = frames.at(-1);
    window.termixNative.onmessage({ data: JSON.stringify({ type: 'response', id: exportFrame.id, result: { cancelled: true } }) });
    assert.equal((await exported).cancelled, true);
});
