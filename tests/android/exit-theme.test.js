'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '../..', file), 'utf8');

for (const isAndroid of [false, true]) {
    test(`${isAndroid ? 'Android' : 'Desktop'} exit automatically closes its tab without a restart prompt`, () => {
        const code = read('public/modules/connection/connection.js');
        const handler = code.slice(code.indexOf('        const disconnectHandler ='), code.indexOf('        // Frontend -> Backend (Input)'));
        const closed = [];
        const context = {
            isAndroid, isUserDisconnected: false, currentSessionId: 'session',
            clearReconnectTimer() {}, clearRestartHandler() {}, toText: value => String(value || ''),
            term: {
                writeln() { assert.fail('must not show ended-session prompt'); },
                clear() { assert.fail('tab manager owns disposal'); },
                onData() { assert.fail('must not install restart handler'); }
            },
            window: { TabManager: { closeTab(id) { closed.push(id); context.isUserDisconnected = true; } } },
            tabId: 'tab',
            setTimeout() { assert.fail('clean exit must not schedule reconnect'); },
            triggerReload() { assert.fail('must not reconnect'); },
            RETRY_RECONNECT_DELAY_MS: 5000
        };
        vm.createContext(context);
        vm.runInContext(handler + '\nthis.disconnect = disconnectHandler;', context);
        context.disconnect(undefined, { sessionId: 'other', exitCode: 0 });
        assert.deepEqual(closed, []);
        context.disconnect(undefined, { sessionId: 'session', exitCode: 0 });
        assert.deepEqual(closed, ['tab']);
        context.disconnect(undefined, { sessionId: 'session', exitCode: 0 });
        assert.deepEqual(closed, ['tab']);
    });
}

test('Android stop-all still closes active and ended tabs and exits SFTP', () => {
    const code = read('public/android/mobile.js');
    const method = code.slice(code.indexOf('        installConnectionStopHandler() {'), code.indexOf('        attachTerminal('));
    let stop;
    const tabs = [{ id: 'dashboard' }, { id: 'active' }, { id: 'ended' }];
    const closed = [];
    let activated;
    let loaded;
    const window = {
        electronAPI: { on(channel, callback) { assert.equal(channel, 'android:all-connections-stopped'); stop = callback; } },
        TabManager: { tabs, closeTab(id) { closed.push(id); tabs.splice(tabs.findIndex(tab => tab.id === id), 1); }, activateTab(id) { activated = id; } },
        ModuleLoader: { currentModule: 'sftp', loadModule(name) { loaded = name; } }
    };
    const mobile = vm.runInNewContext('({' + method + '})', { window, document: { querySelector() { return null; } } });
    mobile.installConnectionStopHandler();
    stop();
    assert.deepEqual(closed, ['active', 'ended']);
    assert.equal(activated, 'dashboard');
    assert.equal(loaded, 'hosts');
});

test('profile and renderer normalize every old UI theme to Modern', async () => {
    const { normalizeUiTheme } = require('../../util/profile-defaults');
    const source = read('public/app.js');
    const code = source.slice(source.indexOf('const ThemeManager ='), source.indexOf('const AppNotify ='));
    const cache = new Map([['termix-ui-theme', 'classic']]);
    let applied;
    const window = {};
    vm.runInNewContext(code, {
        window, console,
        document: { documentElement: { setAttribute(name, value) { applied = value; } } },
        localStorage: { getItem: key => cache.get(key), setItem: (key, value) => cache.set(key, value) }
    });
    for (const value of ['classic', 'modern', 'ocean', 'graphite', 'emerald', 'sunset', '', null, undefined, 'invalid']) {
        assert.equal(normalizeUiTheme(value), 'modern');
        assert.equal(window.ThemeManager.apply(value), 'modern');
        assert.equal(applied, 'modern');
    }
    cache.set('termix-ui-theme', 'classic');
    await window.ThemeManager.init();
    assert.equal(cache.get('termix-ui-theme'), 'modern');
    window.electronAPI = { settings: { getSettings: async () => ({ uiTheme: 'classic' }) } };
    await window.ThemeManager.init();
    assert.equal(applied, 'modern');
    assert.match(read('index.html'), /setAttribute\('data-theme', 'modern'\)/);
    assert.doesNotMatch(read('public/modules/settings/settings.html'), /btn-toggle-theme|Theme: Classic/);
    assert.doesNotMatch(read('public/modules/settings/settings.js'), /btnToggleTheme|Theme: Classic/);
    assert.match(read('public/style.css'), /^:root \{\s*--bg-dark: #1a1f2b;/);
});
