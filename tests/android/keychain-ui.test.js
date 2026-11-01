'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const KEYCHAIN_JS_PATH = path.join(__dirname, '../../public/modules/keychain/keychain.js');
const KEYCHAIN_JS_CODE = fs.readFileSync(KEYCHAIN_JS_PATH, 'utf8');

function setupKeychainDom(options = {}) {
    const isAndroid = options.isAndroid !== false;
    const initialKeys = options.initialKeys || [
        { name: 'id_ed25519.key', relativePath: 'id_ed25519.key', size: '1.20' },
        { name: 'server.pem', relativePath: 'server.pem', size: '2.50' }
    ];

    const dom = new JSDOM(`
        <!DOCTYPE html>
        <html class="${isAndroid ? 'termix-android' : ''}">
        <body>
            <button id="btn-new-key">New Key</button>
            <div id="keys-list"></div>
            <template id="key-edit-template">
                <input id="edit-key-filename" />
                <textarea id="edit-key-content"></textarea>
                <button id="btn-save-key">Save</button>
            </template>
        </body>
        </html>
    `, { runScripts: 'outside-only' });

    const win = dom.window;
    const calls = {
        getKeyFiles: 0,
        readKeyFile: [],
        saveKeyFile: [],
        deleteKeyFile: [],
        openFilesFolder: 0,
        nativeInvokes: [],
        notifications: [],
        confirmPrompts: []
    };

    win.electronAPI = {
        keychain: {
            async getKeyFiles() {
                calls.getKeyFiles++;
                return initialKeys;
            },
            async readKeyFile(filename) {
                calls.readKeyFile.push(filename);
                return { success: true, content: 'PRIVATE KEY CONTENT' };
            },
            async saveKeyFile(oldName, newName, content) {
                calls.saveKeyFile.push({ oldName, newName, content });
                return { success: true };
            },
            async deleteKeyFile(filename) {
                calls.deleteKeyFile.push(filename);
                return { success: true };
            },
            async openFilesFolder() {
                calls.openFilesFolder++;
                return { success: true };
            }
        }
    };

    if (isAndroid) {
        win.TermixAndroid = {
            async invoke(channel, ...args) {
                calls.nativeInvokes.push({ channel, args });
                if (channel === 'native:import-key') {
                    if (options.importCancelled) return { cancelled: true };
                    return { name: 'imported.key', path: '/data/files/imported.key' };
                }
                return {};
            }
        };
    }

    win.Drawer = {
        open() {},
        close() {}
    };

    win.AppConfirm = {
        async confirm(msg, opts) {
            calls.confirmPrompts.push({ msg, opts });
            return options.confirmResult !== false;
        }
    };

    win.notifyUser = (msg, type) => {
        calls.notifications.push({ msg, type });
    };

    const activeIntervals = [];
    win.setInterval = (fn, delay, ...args) => {
        const id = setInterval(fn, delay, ...args);
        if (id && typeof id.unref === 'function') id.unref();
        activeIntervals.push(id);
        return id;
    };
    win.clearInterval = (id) => {
        clearInterval(id);
    };

    return {
        dom,
        win,
        calls,
        cleanup() {
            activeIntervals.forEach(clearInterval);
            dom.window.close();
        }
    };
}

test('Android keychain UI: renders delete button, does not read key on click, handles delete confirmation', async () => {
    const { win, calls, cleanup } = setupKeychainDom({ isAndroid: true, confirmResult: true });
    try {
        // Execute keychain.js inside JSDOM window
        win.eval(KEYCHAIN_JS_CODE);

        // Wait microtasks for loadKeys()
        await new Promise((r) => setTimeout(r, 50));

        const keysList = win.document.getElementById('keys-list');
        const keyItems = keysList.querySelectorAll('.key-item');
        assert.equal(keyItems.length, 2);

        // Verify delete buttons exist inside .key-actions
        const deleteBtns = keysList.querySelectorAll('.btn-delete-key');
        assert.equal(deleteBtns.length, 2);
        assert.equal(deleteBtns[0].dataset.filename, 'id_ed25519.key');
        assert.ok(deleteBtns[0].closest('.key-actions'));

        // Clicking key item on Android must NOT call readKeyFile
        keyItems[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(calls.readKeyFile.length, 0, 'readKeyFile must not be invoked on Android');

        // Clicking delete button prompts AppConfirm and calls deleteKeyFile
        deleteBtns[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 50));

        assert.equal(calls.confirmPrompts.length, 1);
        assert.match(calls.confirmPrompts[0].msg, /id_ed25519\.key/);
        assert.deepEqual(calls.deleteKeyFile, ['id_ed25519.key']);
        assert.ok(calls.notifications.some(n => n.type === 'success' && n.msg.includes('Key deleted')));
    } finally {
        cleanup();
    }
});

test('Android keychain UI: cancellation of delete confirmation cancels deletion', async () => {
    const { win, calls, cleanup } = setupKeychainDom({ isAndroid: true, confirmResult: false });
    try {
        win.eval(KEYCHAIN_JS_CODE);
        await new Promise((r) => setTimeout(r, 50));

        const deleteBtns = win.document.querySelectorAll('.btn-delete-key');
        assert.ok(deleteBtns.length > 0);

        deleteBtns[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 50));

        assert.equal(calls.confirmPrompts.length, 1);
        assert.equal(calls.deleteKeyFile.length, 0, 'deleteKeyFile must not be called when confirmation is cancelled');
    } finally {
        cleanup();
    }
});

test('Android keychain UI: New Key button triggers native:import-key without opening files folder', async () => {
    const { win, calls, cleanup } = setupKeychainDom({ isAndroid: true, importCancelled: false });
    try {
        win.eval(KEYCHAIN_JS_CODE);
        await new Promise((r) => setTimeout(r, 50));

        const newKeyBtn = win.document.getElementById('btn-new-key');
        newKeyBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 50));

        assert.equal(calls.openFilesFolder, 0, 'openFilesFolder must not be called on Android');
        assert.equal(calls.nativeInvokes.length, 1);
        assert.equal(calls.nativeInvokes[0].channel, 'native:import-key');
        assert.ok(calls.notifications.some(n => n.type === 'success' && n.msg.includes('imported.key')));
    } finally {
        cleanup();
    }
});

test('Android keychain UI: New Key button cancellation is handled benignly', async () => {
    const { win, calls, cleanup } = setupKeychainDom({ isAndroid: true, importCancelled: true });
    try {
        win.eval(KEYCHAIN_JS_CODE);
        await new Promise((r) => setTimeout(r, 50));

        const newKeyBtn = win.document.getElementById('btn-new-key');
        newKeyBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 50));

        assert.equal(calls.nativeInvokes.length, 1);
        assert.equal(calls.nativeInvokes[0].channel, 'native:import-key');
        // No error notification on cancellation
        assert.equal(calls.notifications.filter(n => n.type === 'error').length, 0);
    } finally {
        cleanup();
    }
});

test('Desktop keychain UI: preserves reading key and opening files folder', async () => {
    const { win, calls, cleanup } = setupKeychainDom({ isAndroid: false });
    try {
        win.eval(KEYCHAIN_JS_CODE);
        await new Promise((r) => setTimeout(r, 50));

        const keysList = win.document.getElementById('keys-list');
        const deleteBtns = keysList.querySelectorAll('.btn-delete-key');
        assert.equal(deleteBtns.length, 0, 'Desktop should not render .btn-delete-key');

        const keyItems = keysList.querySelectorAll('.key-item');
        assert.equal(keyItems.length, 2);

        // Clicking key item on Desktop calls readKeyFile
        keyItems[0].dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 50));
        assert.deepEqual(calls.readKeyFile, ['id_ed25519.key']);

        // Clicking New Key on Desktop calls openFilesFolder
        const newKeyBtn = win.document.getElementById('btn-new-key');
        newKeyBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
        await new Promise((r) => setTimeout(r, 50));
        assert.equal(calls.openFilesFolder, 1);
    } finally {
        cleanup();
    }
});
