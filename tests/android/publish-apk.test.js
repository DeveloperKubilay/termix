'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { publishApk } = require('../../util/android/publish-apk');

const desktopNames = ['latest.yml', 'latest-linux.yml', 'latest-mac.yml', 'Termix.exe', 'Termix.AppImage', 'Termix.dmg'];

function fixture(t, { release = {}, names = desktopNames, apk = 'test-apk', assetsError = false } = {}) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'termix-publish-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const apkPath = path.join(directory, 'app-debug.apk');
    fs.writeFileSync(apkPath, apk);
    const calls = [];
    const listReleaseAssets = () => {};
    const options = {
        apkPath,
        context: { repo: { owner: 'test-owner', repo: 'test-repo' } },
        runNumber: '12',
        log: () => {},
        github: {
            rest: { repos: {
                async getLatestRelease(parameters) {
                    calls.push({ method: 'getLatestRelease', parameters });
                    return { data: { id: 42, tag_name: 'v1.0.60', draft: false, prerelease: false, ...release } };
                },
                listReleaseAssets,
                async uploadReleaseAsset(parameters) {
                    calls.push({ method: 'uploadReleaseAsset', parameters });
                }
            } },
            async paginate(method, parameters) {
                assert.equal(method, listReleaseAssets);
                assert.deepEqual(parameters, { owner: 'test-owner', repo: 'test-repo', release_id: 42, per_page: 100 });
                if (assetsError) throw new Error('Asset listing failed');
                return names.map(name => ({ name, size: 100 }));
            }
        }
    };
    return { calls, options };
}

test('APK publishing only adds a uniquely named asset to the existing desktop release', async t => {
    const { calls, options } = fixture(t);
    const result = await publishApk(options);
    assert.deepEqual(result, {
        tag: 'v1.0.60', name: 'Termix-android-v1.0.60.12.apk'
    });
    assert.deepEqual(calls.map(call => call.method), ['getLatestRelease', 'uploadReleaseAsset']);
    assert.deepEqual(calls[0].parameters, { owner: 'test-owner', repo: 'test-repo' });
    assert.deepEqual(calls[1].parameters, {
        owner: 'test-owner', repo: 'test-repo', release_id: 42, name: result.name,
        data: Buffer.from('test-apk'), headers: { 'content-type': 'application/vnd.android.package-archive' }
    });
});

test('APK publishing refuses incomplete desktop releases', async t => {
    for (const missing of desktopNames) {
        const { calls, options } = fixture(t, { names: desktopNames.filter(name => name !== missing) });
        await assert.rejects(publishApk(options), /Desktop release is missing/);
        assert.ok(calls.every(call => call.method !== 'uploadReleaseAsset'));
    }
});

test('APK publishing refuses drafts, prereleases, empty APKs and asset listing failures', async t => {
    for (const configuration of [{ release: { draft: true } }, { release: { prerelease: true } }, { apk: '' }, { assetsError: true }]) {
        const { calls, options } = fixture(t, configuration);
        await assert.rejects(publishApk(options));
        assert.ok(calls.every(call => call.method !== 'uploadReleaseAsset'));
    }
});

test('APK publishing never replaces an existing asset', async t => {
    const { calls, options } = fixture(t, {
        names: [...desktopNames, 'Termix-android-v1.0.60.12.apk']
    });
    await assert.rejects(publishApk(options), /existing assets will not be replaced/);
    assert.ok(calls.every(call => call.method !== 'uploadReleaseAsset'));
});

test('APK publishing rejects invalid Android build numbers', async t => {
    for (const runNumber of ['', '0', '01', '-1', '1.2', '12/other', null]) {
        const { calls, options } = fixture(t);
        options.runNumber = runNumber;
        await assert.rejects(publishApk(options), /build number/);
        assert.ok(calls.every(call => call.method !== 'uploadReleaseAsset'));
    }
});

test('APK publishing accepts desktop versions with or without the v prefix', async t => {
    const { options } = fixture(t, { release: { tag_name: '1.0.60' } });
    assert.equal((await publishApk(options)).name, 'Termix-android-v1.0.60.12.apk');
});

test('APK publishing rejects malformed or prerelease version tags', async t => {
    for (const tag_name of ['', 'latest', 'v1.0', 'v01.0.60', 'v1.0.60-beta', 'v1.0.60/other']) {
        const { calls, options } = fixture(t, { release: { tag_name } });
        await assert.rejects(publishApk(options), /release tag/);
        assert.ok(calls.every(call => call.method !== 'uploadReleaseAsset'));
    }
});
