'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const androidModules = path.join(__dirname, 'node_modules');

const env = {
    ...process.env,
    NODE_PATH: androidModules + (process.env.NODE_PATH ? path.delimiter + process.env.NODE_PATH : '')
};

const testFiles = [
    'tests/android/backend-registry.test.js',
    'tests/android/backend-ssh-fixture.test.js',
    'tests/android/backend-transport.test.js',
    'tests/android/host-trust.test.js',
    'tests/android/trust-ui.test.js',
    'tests/android/mobile-terminal.test.js',
    'tests/android/settings-ui.test.js',
    'tests/android/keychain-ui.test.js',
    'tests/android/bridge.test.js',
    'tests/android/exit-theme.test.js',
    'tests/android/transfers.test.js'
];

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
    cwd: ROOT,
    stdio: 'inherit',
    env
});

process.exit(result.status ?? 0);
