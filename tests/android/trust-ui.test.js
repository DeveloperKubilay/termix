'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(path.join(__dirname, '../../public/android/mobile.js'), 'utf8');

function harness() {
    const dom = new JSDOM('<!doctype html><body></body>', { runScripts: 'outside-only' });
    const calls = [];
    const notices = [];
    let listener;
    dom.window.TermixAndroid = { invoke: async (...args) => calls.push(args) };
    dom.window.electronAPI = { on: (_channel, handler) => { listener = handler; } };
    dom.window.confirmAction = () => { throw new Error('Trust prompt must not open'); };
    dom.window.notifyUser = (...args) => notices.push(args);
    dom.window.eval(source);
    dom.window.TermixMobile.installTrustPrompt();
    return { dom, calls, notices, emit: payload => listener(null, payload) };
}

test('Android first-use events do not prompt or send approval requests', async () => {
    const h = harness();
    try {
        await h.emit({ address: 'fixture.invalid', port: 22222, changed: false });
        await h.emit(null);
        assert.deepEqual(h.calls, []);
        assert.deepEqual(h.notices, []);
    } finally { h.dom.window.close(); }
});

test('Android changed host key displays blocking error without a trust prompt', async () => {
    const h = harness();
    try {
        await h.emit({ address: 'fixture.invalid', port: 22222, changed: true });
        assert.deepEqual(h.calls, []);
        assert.equal(h.notices[0][1], 'error');
        assert.match(h.notices[0][0], /fixture\.invalid:22222/);
    } finally { h.dom.window.close(); }
});
