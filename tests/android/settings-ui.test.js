'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SETTINGS_JS_PATH = path.join(__dirname, '../../public/modules/settings/settings.js');
const SETTINGS_JS_CODE = fs.readFileSync(SETTINGS_JS_PATH, 'utf8');

function createMockElement(id, initialProps = {}) {
    const listeners = {};
    const element = {
        id,
        tagName: initialProps.tagName || 'DIV',
        value: initialProps.value !== undefined ? initialProps.value : '',
        checked: initialProps.checked !== undefined ? initialProps.checked : false,
        textContent: initialProps.textContent || '',
        innerHTML: initialProps.innerHTML || '',
        hidden: false,
        disabled: false,
        style: { borderColor: '', background: '', color: '', pointerEvents: '', opacity: '', display: '' },
        classList: {
            _classes: new Set(),
            add(c) { this._classes.add(c); },
            remove(c) { this._classes.delete(c); },
            contains(c) { return this._classes.has(c); },
            toggle(c, val) {
                if (val === undefined) val = !this.contains(c);
                if (val) this.add(c); else this.remove(c);
                return val;
            }
        },
        parentElement: null,
        children: [],
        addEventListener(event, fn) {
            if (!listeners[event]) listeners[event] = [];
            listeners[event].push(fn);
        },
        dispatchEvent(event) {
            const handlers = listeners[event.type] || [];
            for (const h of handlers) h.call(this, event);
        },
        click() {
            this.dispatchEvent({ type: 'click', target: this });
        },
        ...initialProps
    };
    if (initialProps.parentElement) {
        element.parentElement = initialProps.parentElement;
    } else {
        element.parentElement = {
            style: { borderColor: '' },
            appendChild() {}
        };
    }
    return element;
}

function createEnvironment(options = {}) {
    const elements = new Map();

    function getOrCreateElement(id, props = {}) {
        if (!elements.has(id)) {
            elements.set(id, createMockElement(id, props));
        }
        return elements.get(id);
    }

    getOrCreateElement('ai-method', { tagName: 'SELECT', value: 'GET' });
    getOrCreateElement('ai-url', { tagName: 'INPUT', value: '' });
    getOrCreateElement('ai-body', { tagName: 'TEXTAREA', value: '' });
    getOrCreateElement('ai-headers', { tagName: 'TEXTAREA', value: '' });
    getOrCreateElement('btn-toggle-theme', { tagName: 'BUTTON' });
    getOrCreateElement('btn-delete-account', { tagName: 'BUTTON' });
    getOrCreateElement('delete-account-panel', { tagName: 'DIV' });
    getOrCreateElement('delete-account-message', { tagName: 'P' });
    getOrCreateElement('btn-confirm-delete-account', { tagName: 'BUTTON' });
    getOrCreateElement('btn-cancel-delete-account', { tagName: 'BUTTON' });
    getOrCreateElement('current-user-name', { tagName: 'H3' });
    getOrCreateElement('storage-type', { tagName: 'SPAN' });
    getOrCreateElement('firebase-sync-options', { tagName: 'DIV' });
    getOrCreateElement('sync-provider-name', { tagName: 'SPAN' });
    getOrCreateElement('sync-provider-description', { tagName: 'P' });
    getOrCreateElement('tags-list', { tagName: 'DIV' });
    getOrCreateElement('sftp-overwrite-confirm-toggle', { tagName: 'INPUT', checked: true });
    getOrCreateElement('sftp-skip-patterns-toggle', { tagName: 'INPUT', checked: false });
    getOrCreateElement('sftp-skip-patterns', { tagName: 'TEXTAREA', value: 'node_modules\n.git\n.DS_Store' });
    getOrCreateElement('auto-update-toggle', { tagName: 'INPUT', checked: true });
    getOrCreateElement('update-current-version', { tagName: 'STRONG' });
    getOrCreateElement('update-available-version', { tagName: 'STRONG' });
    getOrCreateElement('update-last-checked', { tagName: 'STRONG' });
    getOrCreateElement('update-message', { tagName: 'P' });
    getOrCreateElement('update-progress-wrap', { tagName: 'DIV' });
    getOrCreateElement('update-progress-fill', { tagName: 'DIV' });
    getOrCreateElement('update-progress-text', { tagName: 'DIV' });
    getOrCreateElement('btn-check-update', { tagName: 'BUTTON' });
    getOrCreateElement('btn-install-update', { tagName: 'BUTTON' });
    getOrCreateElement('btn-open-source-code', { tagName: 'BUTTON' });
    getOrCreateElement('mcp-enabled-toggle', { tagName: 'INPUT' });
    getOrCreateElement('mcp-port', { tagName: 'INPUT', value: '8790' });
    getOrCreateElement('mcp-token', { tagName: 'INPUT', value: '' });
    getOrCreateElement('mcp-client-config', { tagName: 'DIV' });
    getOrCreateElement('mcp-status-dot', { tagName: 'DIV' });
    getOrCreateElement('mcp-status-text', { tagName: 'SPAN' });
    getOrCreateElement('mcp-block-destructive-toggle', { tagName: 'INPUT' });
    getOrCreateElement('mcp-allow-sessions-toggle', { tagName: 'INPUT' });
    getOrCreateElement('mcp-blocked-patterns', { tagName: 'TEXTAREA' });
    getOrCreateElement('btn-mcp-save', { tagName: 'BUTTON' });
    getOrCreateElement('btn-mcp-copy-token', { tagName: 'BUTTON' });
    getOrCreateElement('btn-mcp-copy-config', { tagName: 'BUTTON' });
    getOrCreateElement('btn-mcp-regenerate', { tagName: 'BUTTON' });
    getOrCreateElement('btn-open-profile-folder', { tagName: 'BUTTON' });
    getOrCreateElement('btn-open-config-file', { tagName: 'BUTTON' });
    getOrCreateElement('btn-save-settings', { tagName: 'BUTTON', innerHTML: 'Save All Settings' });
    getOrCreateElement('btn-sync-pull', { tagName: 'BUTTON' });
    getOrCreateElement('btn-sync-push', { tagName: 'BUTTON' });
    getOrCreateElement('terminal-font-size', { tagName: 'INPUT', value: '11' });
    getOrCreateElement('terminal-cursor-blink-toggle', { tagName: 'INPUT', checked: true });
    getOrCreateElement('terminal-copy-paste-toggle', { tagName: 'INPUT', checked: true });

    const dispatchedEvents = [];
    const windowListeners = {};

    class MockCustomEvent {
        constructor(type, eventInitDict = {}) {
            this.type = type;
            this.detail = eventInitDict.detail;
        }
    }

    const docElement = {
        getAttribute(name) { return name === 'data-theme' ? 'modern' : null; },
        setAttribute() {},
        classList: { add() {}, remove() {}, contains() { return false; } }
    };

    const documentMock = {
        documentElement: docElement,
        getElementById(id) {
            return getOrCreateElement(id);
        }
    };

    const windowMock = {
        document: documentMock,
        documentElement: docElement,
        CustomEvent: MockCustomEvent,
        ThemeManager: {
            getCurrentTheme: () => 'modern',
            apply: (t) => t
        },
        addEventListener(event, fn) {
            if (!windowListeners[event]) windowListeners[event] = [];
            windowListeners[event].push(fn);
        },
        removeEventListener(event, fn) {
            if (windowListeners[event]) {
                windowListeners[event] = windowListeners[event].filter(h => h !== fn);
            }
        },
        dispatchEvent(event) {
            dispatchedEvents.push(event);
            const handlers = windowListeners[event.type] || [];
            for (const h of handlers) h.call(this, event);
        },
        notifyUser() {},
        confirmAction: async () => true,
        setTimeout(fn, ms) { return 1; },
        clearTimeout() {},
        ...options.windowOverrides
    };

    if (options.isAndroid !== false) {
        windowMock.TermixAndroid = options.termixAndroid || {
            hasCapability: (cap) => (options.capabilities && options.capabilities[cap] === true) || false
        };
    } else {
        delete windowMock.TermixAndroid;
    }

    const electronAPIMock = {
        settings: {
            getSettings: async () => ({
                profile: { name: 'TestUser', type: 'local' },
                tags: [],
                sftpSettings: { confirmOverwriteOnConflict: true, skipPatternsEnabled: false, skipPatterns: [] },
                uiTheme: 'modern',
                ai: { method: 'GET', url: '', body: {}, headers: {} }
            }),
            saveSettings: async (payload) => {
                if (options.onSaveSettings) return options.onSaveSettings(payload);
                return { success: true };
            },
            getUpdateSettings: async () => ({
                supported: false,
                autoUpdateEnabled: false,
                status: 'disabled'
            })
        },
        connection: {
            getSettings: async () => ({
                fontSize: 14,
                mobileFontSize: 11,
                cursorBlink: true,
                rightClickCopyPaste: true
            }),
            saveSettings: async (payload) => {
                if (options.onConnectionSaveSettings) return options.onConnectionSaveSettings(payload);
                return { success: true };
            }
        },
        profiles: {
            getProfiles: async () => ({ activeProfileId: 'default', profiles: [{ id: 'default', name: 'TestUser', type: 'local' }] })
        },
        mcp: null,
        on: () => ({ dispose() {} }),
        ...options.electronAPIOverrides
    };

    windowMock.electronAPI = electronAPIMock;

    return {
        window: windowMock,
        document: documentMock,
        elements,
        dispatchedEvents,
        getOrCreateElement
    };
}

function runSettings(env) {
    const context = {
        window: env.window,
        document: env.document,
        CustomEvent: env.window.CustomEvent,
        URL,
        console: { log() {}, warn() {}, error() {} },
        setTimeout: env.window.setTimeout,
        clearTimeout: env.window.clearTimeout
    };
    vm.runInNewContext(SETTINGS_JS_CODE, context);
}

test('Android save: skips AI validation, omits ai and updateSettings, preserves terminal settings, and dispatches termix:terminal-settings-changed', async () => {
    let savedSettingsPayload = null;
    let savedConnectionPayload = null;

    const env = createEnvironment({
        isAndroid: true,
        capabilities: { ai: false, updater: false },
        onSaveSettings: async (payload) => {
            savedSettingsPayload = payload;
            return { success: true };
        },
        onConnectionSaveSettings: async (payload) => {
            savedConnectionPayload = payload;
            return { success: true };
        }
    });

    runSettings(env);
    await Promise.resolve();

    // Populate invalid AI values that would break desktop validation
    const aiUrl = env.getOrCreateElement('ai-url');
    const aiBody = env.getOrCreateElement('ai-body');
    const aiHeaders = env.getOrCreateElement('ai-headers');
    aiUrl.value = 'invalid ::: not a url';
    aiBody.value = '{ invalid json body: 123';
    aiHeaders.value = '{ invalid headers: ';

    // Populate terminal inputs
    const fontSizeInput = env.getOrCreateElement('terminal-font-size');
    const cursorBlinkToggle = env.getOrCreateElement('terminal-cursor-blink-toggle');
    const copyPasteToggle = env.getOrCreateElement('terminal-copy-paste-toggle');
    fontSizeInput.value = '12';
    cursorBlinkToggle.checked = true;
    copyPasteToggle.checked = false;

    // Populate SFTP inputs
    const sftpOverwrite = env.getOrCreateElement('sftp-overwrite-confirm-toggle');
    const sftpSkipToggle = env.getOrCreateElement('sftp-skip-patterns-toggle');
    const sftpSkipPatterns = env.getOrCreateElement('sftp-skip-patterns');
    sftpOverwrite.checked = true;
    sftpSkipToggle.checked = true;
    sftpSkipPatterns.value = 'node_modules\n.git\ndist';

    const btnSave = env.getOrCreateElement('btn-save-settings');
    btnSave.click();
    await Promise.resolve();
    await new Promise(r => setImmediate(r));

    // 1. AI validation was skipped: no red borders
    assert.notEqual(aiUrl.parentElement.style.borderColor, '#ff4444', 'AI URL border should not be red on Android');
    assert.notEqual(aiBody.style.borderColor, '#ff4444', 'AI Body border should not be red on Android');
    assert.notEqual(aiHeaders.style.borderColor, '#ff4444', 'AI Headers border should not be red on Android');

    // 2. Settings payload omits ai and updateSettings, preserves sftp and theme
    assert.ok(savedSettingsPayload, 'Settings payload should be saved');
    assert.equal('ai' in savedSettingsPayload, false, 'Android settings payload must omit ai');
    assert.equal('updateSettings' in savedSettingsPayload, false, 'Android settings payload must omit updateSettings');
    assert.equal(savedSettingsPayload.sftpSettings.confirmOverwriteOnConflict, true);
    assert.equal(savedSettingsPayload.sftpSettings.skipPatternsEnabled, true);
    assert.deepEqual(Array.from(savedSettingsPayload.sftpSettings.skipPatterns), ['node_modules', '.git', 'dist']);
    assert.equal(savedSettingsPayload.uiTheme, 'modern');

    // 3. Terminal payload preserves mobileFontSize, cursorBlink, rightClickCopyPaste
    assert.ok(savedConnectionPayload, 'Connection payload should be saved');
    assert.equal(savedConnectionPayload.mobileFontSize, 12);
    assert.equal(savedConnectionPayload.cursorBlink, true);
    assert.equal(savedConnectionPayload.rightClickCopyPaste, false);

    // 4. CustomEvent('termix:terminal-settings-changed', { detail: terminalPayload }) was dispatched
    const termEvent = env.dispatchedEvents.find(e => e.type === 'termix:terminal-settings-changed');
    assert.ok(termEvent, 'termix:terminal-settings-changed event must be dispatched');
    assert.equal(termEvent.detail.mobileFontSize, 12);
    assert.equal(termEvent.detail.cursorBlink, true);
    assert.equal(termEvent.detail.rightClickCopyPaste, false);

    // 5. Button reflects Saved state
    assert.ok(btnSave.innerHTML.includes('Saved'), 'Save button should show Saved!');
});

test('Android save: terminal save failure propagates to Error state and is not swallowed into Saved', async () => {
    let settingsSaved = false;

    const env = createEnvironment({
        isAndroid: true,
        capabilities: { ai: false },
        onConnectionSaveSettings: async () => {
            throw new Error('Terminal IPC failure');
        },
        onSaveSettings: async () => {
            settingsSaved = true;
            return { success: true };
        }
    });

    runSettings(env);
    await Promise.resolve();

    const btnSave = env.getOrCreateElement('btn-save-settings');
    btnSave.click();
    await Promise.resolve();
    await new Promise(r => setImmediate(r));

    // Must propagate to Error
    assert.ok(btnSave.innerHTML.includes('Error'), 'Save button must show Error when terminal settings fail on Android');
    assert.equal(btnSave.style.background, '#f38ba8');
    assert.equal(settingsSaved, false, 'Settings save must not proceed when terminal save fails');

    // No terminal settings event dispatched on failure
    const termEvent = env.dispatchedEvents.find(e => e.type === 'termix:terminal-settings-changed');
    assert.equal(termEvent, undefined, 'No terminal-settings-changed event should be dispatched on failure');
});

test('Android save: terminal save returning success=false propagates to Error state', async () => {
    let settingsSaved = false;

    const env = createEnvironment({
        isAndroid: true,
        capabilities: { ai: false },
        onConnectionSaveSettings: async () => {
            return { success: false, message: 'Invalid terminal params' };
        },
        onSaveSettings: async () => {
            settingsSaved = true;
            return { success: true };
        }
    });

    runSettings(env);
    await Promise.resolve();

    const btnSave = env.getOrCreateElement('btn-save-settings');
    btnSave.click();
    await Promise.resolve();
    await new Promise(r => setImmediate(r));

    assert.ok(btnSave.innerHTML.includes('Error'), 'Save button must show Error when connection save returns success=false');
    assert.equal(settingsSaved, false);
});

test('Android save: when settings.saveSettings fails after terminal save, event is NOT dispatched and button shows Error', async () => {
    let terminalSaved = false;

    const env = createEnvironment({
        isAndroid: true,
        capabilities: { ai: false },
        onConnectionSaveSettings: async () => {
            terminalSaved = true;
            return { success: true };
        },
        onSaveSettings: async () => {
            throw new Error('Settings backend failure');
        }
    });

    runSettings(env);
    await Promise.resolve();

    const btnSave = env.getOrCreateElement('btn-save-settings');
    btnSave.click();
    await Promise.resolve();
    await new Promise(r => setImmediate(r));

    assert.equal(terminalSaved, true, 'Terminal settings were saved first');
    assert.ok(btnSave.innerHTML.includes('Error'), 'Button must show Error when settings save fails');
    const termEvent = env.dispatchedEvents.find(e => e.type === 'termix:terminal-settings-changed');
    assert.equal(termEvent, undefined, 'Terminal event must NOT be dispatched if main settings save fails');
});

test('Desktop save: preserves AI validation and halts on invalid AI JSON body', async () => {
    let settingsSaved = false;

    const env = createEnvironment({
        isAndroid: false, // Desktop
        onSaveSettings: async () => {
            settingsSaved = true;
            return { success: true };
        }
    });

    runSettings(env);
    await Promise.resolve();

    const aiUrl = env.getOrCreateElement('ai-url');
    const aiBody = env.getOrCreateElement('ai-body');
    aiUrl.value = 'http://api.example.com/v1';
    aiBody.value = '{ invalid json body';

    const btnSave = env.getOrCreateElement('btn-save-settings');
    btnSave.click();
    await Promise.resolve();

    // Desktop sets red border and halts
    assert.equal(aiBody.style.borderColor, '#ff4444', 'AI Body border should be red on invalid JSON on desktop');
    assert.equal(settingsSaved, false, 'Desktop save must not proceed when AI body is invalid');
});

test('Desktop save: includes AI payload, uses fontSize, and does not dispatch Android terminal event', async () => {
    let savedSettingsPayload = null;
    let savedConnectionPayload = null;

    const env = createEnvironment({
        isAndroid: false, // Desktop
        onSaveSettings: async (payload) => {
            savedSettingsPayload = payload;
            return { success: true };
        },
        onConnectionSaveSettings: async (payload) => {
            savedConnectionPayload = payload;
            return { success: true };
        }
    });

    runSettings(env);
    await Promise.resolve();

    const aiUrl = env.getOrCreateElement('ai-url');
    const aiBody = env.getOrCreateElement('ai-body');
    const aiHeaders = env.getOrCreateElement('ai-headers');
    aiUrl.value = 'http://api.example.com/chat';
    aiBody.value = '{"model":"qwen2.5"}';
    aiHeaders.value = '{"Authorization":"Bearer 123"}';

    const fontSizeInput = env.getOrCreateElement('terminal-font-size');
    fontSizeInput.value = '16';

    const btnSave = env.getOrCreateElement('btn-save-settings');
    btnSave.click();
    await Promise.resolve();
    await new Promise(r => setImmediate(r));

    // Desktop sends ai payload
    assert.ok(savedSettingsPayload, 'Desktop payload must be saved');
    assert.ok(savedSettingsPayload.ai, 'Desktop settings payload must include ai');
    assert.equal(savedSettingsPayload.ai.url, 'http://api.example.com/chat');
    assert.deepEqual(JSON.parse(JSON.stringify(savedSettingsPayload.ai.body)), { model: 'qwen2.5' });
    assert.deepEqual(JSON.parse(JSON.stringify(savedSettingsPayload.ai.headers)), { Authorization: 'Bearer 123' });

    // Desktop uses fontSize, not mobileFontSize
    assert.ok(savedConnectionPayload, 'Connection payload must be saved');
    assert.equal(savedConnectionPayload.fontSize, 16);
    assert.equal('mobileFontSize' in savedConnectionPayload, false);

    // Desktop does not dispatch Android CustomEvent
    const termEvent = env.dispatchedEvents.find(e => e.type === 'termix:terminal-settings-changed');
    assert.equal(termEvent, undefined, 'Desktop should not dispatch termix:terminal-settings-changed');
    assert.ok(btnSave.innerHTML.includes('Saved'), 'Desktop save button should show Saved!');
});

test('Desktop save: terminal save failure is tolerated and does not block main settings save', async () => {
    let settingsSaved = false;

    const env = createEnvironment({
        isAndroid: false, // Desktop
        onConnectionSaveSettings: async () => {
            throw new Error('Desktop terminal IPC warning');
        },
        onSaveSettings: async () => {
            settingsSaved = true;
            return { success: true };
        }
    });

    runSettings(env);
    await Promise.resolve();

    const btnSave = env.getOrCreateElement('btn-save-settings');
    btnSave.click();
    await Promise.resolve();
    await new Promise(r => setImmediate(r));

    assert.equal(settingsSaved, true, 'Desktop should proceed with settings save even if terminal save warns');
    assert.ok(btnSave.innerHTML.includes('Saved'), 'Desktop button should show Saved!');
});

test('Capability-aware Android: when AI capability is enabled, AI validation and payload are active', async () => {
    let savedSettingsPayload = null;

    const env = createEnvironment({
        isAndroid: true,
        capabilities: { ai: true, updater: false },
        onSaveSettings: async (payload) => {
            savedSettingsPayload = payload;
            return { success: true };
        }
    });

    runSettings(env);
    await Promise.resolve();

    const aiUrl = env.getOrCreateElement('ai-url');
    const aiBody = env.getOrCreateElement('ai-body');
    aiUrl.value = 'http://android-ai.local';
    aiBody.value = '{"prompt":"hello"}';

    const btnSave = env.getOrCreateElement('btn-save-settings');
    btnSave.click();
    await Promise.resolve();
    await new Promise(r => setImmediate(r));

    assert.ok(savedSettingsPayload.ai, 'When AI capability is true, ai should be included in payload');
    assert.equal(savedSettingsPayload.ai.url, 'http://android-ai.local');
});
