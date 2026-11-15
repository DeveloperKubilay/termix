'use strict';

const path = require('node:path');

async function buildStoreTest() {
    if (process.platform !== 'win32') {
        throw new Error('Build the Windows Store test package on Windows.');
    }
    process.env.CSC_IDENTITY_AUTO_DISCOVERY = 'false';
    if (process.env.CSC_LINK || process.env.WIN_CSC_LINK) {
        throw new Error('Remove CSC_LINK/WIN_CSC_LINK before building the unsigned test package.');
    }

    const { build, Platform, Arch } = require('electron-builder');
    const config = require('../../electron-builder.store-test.cjs');
    const projectDir = path.resolve(__dirname, '../..');
    const { rebuild } = require('@electron/rebuild');
    await rebuild({
        buildPath: projectDir,
        electronVersion: require('electron/package.json').version,
        arch: 'x64',
        // node-pty ships Node-API prebuilds; avoid rebuilding its legacy WinPTY tools.
        onlyModules: ['@serialport/bindings-cpp']
    });
    const artifacts = await build({
        projectDir: path.resolve(__dirname, '../..'),
        targets: Platform.WINDOWS.createTarget('appx', Arch.x64),
        config,
        publish: 'never'
    });
    const packages = artifacts.filter(artifact => artifact.endsWith('.appx'));
    if (packages.length !== 1) {
        throw new Error(`Expected one x64 AppX package, received ${packages.length}.`);
    }
    const { verifyStoreTest } = require('./verify-store-test');
    await verifyStoreTest(packages[0]);
    console.log(`Unsigned test package ready: ${packages[0]}`);
}

if (require.main === module) {
    buildStoreTest().catch(error => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = { buildStoreTest };
