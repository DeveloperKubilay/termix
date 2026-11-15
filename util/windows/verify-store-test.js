'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../../electron-builder.store-test.cjs');

function checkManifest(manifest) {
    assert.equal(manifest.identity, config.appx.identityName);
    assert.equal(manifest.publisher, config.appx.publisher);
    assert.equal(manifest.architecture, 'x64');
    assert.ok(manifest.capabilities.includes('runFullTrust'));
    assert.ok(!manifest.entries.includes('AppxSignature.p7x'), 'Test package must be unsigned.');
}

function checkPayload(entries) {
    for (const entry of entries) {
        const name = entry.replace(/\\/g, '/').replace(/^\//, '');
        assert.ok(!/^node_modules\/cpu-features(\/|$)/.test(name), 'Optional cpu-features payload must not be packaged.');
        if (name.startsWith('node_modules/')) continue;
        assert.ok(!/^(profiles|files|website|android|tests|local|dist|\.claude)(\/|$)/.test(name), `Unexpected payload: ${name}`);
        assert.ok(!/^commands\/profiles\/profiles(\/|$)/.test(name), `Legacy profile payload: ${name}`);
        assert.ok(!/^util\/android(\/|$)/.test(name), `Android payload: ${name}`);
        assert.ok(!/(^|\/)(kubitdb\.json|\.env(?:\..*)?)$|\.(pem|key|pfx|p12|jks|keystore)$/i.test(name), `Private payload: ${name}`);
    }
}

async function verifyStoreTest(packagePath) {
    const { listPackage, extractFile } = await import('@electron/asar');
    const { Open } = require('unzipper');
    const { JSDOM } = require('jsdom');
    const archive = await Open.file(packagePath);
    const manifestEntry = archive.files.find(entry => entry.path === 'AppxManifest.xml');
    assert.ok(manifestEntry, 'AppxManifest.xml missing.');
    const dom = new JSDOM((await manifestEntry.buffer()).toString(), { contentType: 'text/xml' });
    const identity = dom.window.document.querySelector('Identity');
    assert.ok(identity, 'Package identity missing.');
    const asars = archive.files.filter(entry => /(^|\/)resources\/app\.asar$/.test(entry.path));
    assert.equal(asars.length, 1, 'Expected exactly one packaged ASAR.');
    const archiveHash = crypto.createHash('sha256');
    for await (const chunk of asars[0].stream()) archiveHash.update(chunk);
    const manifest = {
        identity: identity.getAttribute('Name'),
        publisher: identity.getAttribute('Publisher'),
        architecture: identity.getAttribute('ProcessorArchitecture'),
        version: identity.getAttribute('Version'),
        capabilities: [...dom.window.document.querySelectorAll('Capabilities > *')].map(element => element.getAttribute('Name')),
        entries: archive.files.map(entry => decodeURIComponent(entry.path)),
        asarSha256: archiveHash.digest('hex')
    };
    dom.window.close();
    checkManifest(manifest);
    const asarPath = path.join(path.dirname(packagePath), 'win-unpacked/resources/app.asar');
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(asarPath)) hash.update(chunk);
    assert.equal(hash.digest('hex'), manifest.asarSha256, 'Package ASAR differs from inspected payload.');
    checkPayload(listPackage(asarPath));
    const metadata = JSON.parse(extractFile(asarPath, 'package.json').toString());
    assert.equal(metadata.name, config.extraMetadata.name);
    assert.equal(metadata.main, config.extraMetadata.main);
    const unpacked = manifest.entries.filter(name => name.includes('app.asar.unpacked/'));
    assert.ok(unpacked.some(name => /node-pty\/.*\.node$/.test(name)), 'Unpacked PTY binding missing.');
    assert.ok(unpacked.some(name => /node-pty\/.*winpty-agent\.exe$/.test(name)), 'WinPTY agent missing.');
    assert.ok(unpacked.some(name => /@serialport\/.*\.node$/.test(name)), 'Serial binding missing.');
    console.log('Verified unsigned x64 identity, isolated entrypoint, payload exclusions and native helpers.');
    return manifest;
}

if (require.main === module) {
    verifyStoreTest(process.argv[2]).catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
}

module.exports = { verifyStoreTest, checkManifest, checkPayload };
