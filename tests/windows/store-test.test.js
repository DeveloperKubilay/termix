'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const config = require('../../electron-builder.store-test.cjs');
const { checkManifest, checkPayload } = require('../../util/windows/verify-store-test');
const root = path.resolve(__dirname, '../..');

function updaterFixture({ store = false, packaged = true } = {}) {
    const calls = [];
    const autoUpdater = {
        on() { calls.push('bind'); },
        async checkForUpdates() { calls.push('check'); return {}; }
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'util/updater.js'), 'utf8'), {
        module, exports: module.exports, process: { windowsStore: store }, console,
        setTimeout, clearTimeout,
        require(name) {
            if (name === 'electron') return {
                app: { isPackaged: packaged, getVersion: () => '1.0.0', on() {} },
                BrowserWindow: { getAllWindows: () => [] }
            };
            if (name === './profile-db') return { get: () => ({ autoUpdateEnabled: false }), set() {} };
            if (name === 'electron-updater') return { autoUpdater };
            throw new Error(`Unexpected import ${name}`);
        }
    });
    return { updater: module.exports, calls };
}

test('test packaging leaves production targets and identity unchanged', () => {
    const production = require('../../package.json');
    assert.equal(production.build.win.target, 'nsis');
    assert.equal(production.name, 'Termix');
    assert.equal(production.scripts.build, 'electron-builder');
    assert.equal(config.extends, null);
    assert.equal(config.publish, null);
    assert.equal(config.directories.output, 'dist/store-test');
    assert.deepEqual(config.win.target, [{ target: 'appx', arch: ['x64'] }]);
    assert.notEqual(config.extraMetadata.name, production.name);
    assert.match(config.appx.publisher, /, OID\.2\.25\.311729368913984317654407730594956997722=1$/);
});

test('test bootstrap sets isolated userData before loading the application', () => {
    const calls = [];
    vm.runInNewContext(fs.readFileSync(path.join(root, config.extraMetadata.main), 'utf8'), {
        require(name) {
            if (name === 'node:path') return path;
            if (name === 'node:fs') return { mkdirSync() {} };
            if (name === 'electron') return { app: {
                setName: value => calls.push(['name', value]),
                getPath: () => '/isolated-appdata',
                setPath: (key, value) => calls.push([key, value])
            } };
            if (name === '../../index') { calls.push(['load']); return {}; }
            throw new Error(`Unexpected import ${name}`);
        }
    });
    assert.deepEqual(calls, [
        ['name', 'Termix Store Test'],
        ['userData', path.join('/isolated-appdata', 'Termix Store Test')], ['load']
    ]);
});

test('AppX updater disables checks, downloads and installation', async () => {
    const { updater, calls } = updaterFixture({ store: true });
    assert.equal(updater.init().supported, false);
    assert.equal(updater.getState().status, 'disabled');
    await updater.checkForUpdates();
    await updater.downloadUpdate();
    updater.installUpdate();
    assert.deepEqual(calls, []);
});

test('NSIS updater still initializes and development builds stay disabled', () => {
    const nsis = updaterFixture();
    assert.equal(nsis.updater.init().supported, true);
    assert.ok(nsis.calls.includes('bind'));
    const dev = updaterFixture({ packaged: false });
    assert.equal(dev.updater.init().supported, false);
    assert.deepEqual(dev.calls, []);
});

test('payload checker rejects private data and non-runtime directories', () => {
    checkPayload(['/index.js', '/commands/profiles/profiles.html', '/public/app.js']);
    for (const entry of ['profiles/user.json', 'files/key', 'commands/profiles/profiles/a.json',
        'website/app.js', 'android/build/a', 'util/android/build.js', 'local/a', '.env', 'util/private.pem', 'kubitdb.json', 'node_modules/cpu-features/package.json']) {
        assert.throws(() => checkPayload([entry]), /payload/i);
    }
});

test('manifest checker requires the unsigned isolated x64 package', () => {
    const manifest = {
        identity: config.appx.identityName, publisher: config.appx.publisher,
        architecture: 'x64', capabilities: ['runFullTrust'], entries: []
    };
    checkManifest(manifest);
    for (const change of [{ architecture: 'arm64' }, { identity: 'Termix' },
        { publisher: 'CN=Other' }, { entries: ['AppxSignature.p7x'] }]) {
        assert.throws(() => checkManifest({ ...manifest, ...change }));
    }
});
