'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { publishApk, formatReleaseAssetName } = require('../../util/android/publish-apk');

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

test('formatReleaseAssetName appends ABI suffix for split APKs and leaves monolithic clean', () => {
    assert.equal(formatReleaseAssetName('1.0.60', '12', 'app-arm64-v8a-debug.apk'), 'Termix-android-v1.0.60.12-arm64-v8a.apk');
    assert.equal(formatReleaseAssetName('1.0.60', '12', 'app-x86_64-debug.apk'), 'Termix-android-v1.0.60.12-x86_64.apk');
    assert.equal(formatReleaseAssetName('1.0.60', '12', 'app-debug.apk'), 'Termix-android-v1.0.60.12.apk');
    assert.equal(formatReleaseAssetName('1.0.60', '12', 'Termix.apk'), 'Termix-android-v1.0.60.12.apk');
});

test('APK publishing uploads all split APKs from a directory with ABI suffixes', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'termix-publish-dir-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.writeFileSync(path.join(directory, 'app-arm64-v8a-debug.apk'), 'arm64-content');
    fs.writeFileSync(path.join(directory, 'app-x86_64-debug.apk'), 'x86_64-content');

    const calls = [];
    const options = {
        apkPath: directory,
        context: { repo: { owner: 'test-owner', repo: 'test-repo' } },
        runNumber: '12',
        log: () => {},
        github: {
            rest: { repos: {
                async getLatestRelease() {
                    return { data: { id: 42, tag_name: 'v1.0.60', draft: false, prerelease: false } };
                },
                listReleaseAssets: () => {},
                async uploadReleaseAsset(parameters) {
                    calls.push(parameters);
                }
            } },
            async paginate() {
                return desktopNames.map(name => ({ name, size: 100 }));
            }
        }
    };

    const result = await publishApk(options);
    assert.deepEqual(result, {
        tag: 'v1.0.60',
        name: 'Termix-android-v1.0.60.12-arm64-v8a.apk',
        names: [
            'Termix-android-v1.0.60.12-arm64-v8a.apk',
            'Termix-android-v1.0.60.12-x86_64.apk'
        ]
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].name, 'Termix-android-v1.0.60.12-arm64-v8a.apk');
    assert.equal(calls[0].data.toString(), 'arm64-content');
    assert.equal(calls[1].name, 'Termix-android-v1.0.60.12-x86_64.apk');
    assert.equal(calls[1].data.toString(), 'x86_64-content');
});

test('APK publishing rejects directories with no APK files or empty APKs', async t => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'termix-empty-dir-'));
    t.after(() => fs.rmSync(emptyDir, { recursive: true, force: true }));
    const { options: opt1 } = fixture(t);
    opt1.apkPath = emptyDir;
    await assert.rejects(publishApk(opt1), /no APK files/);

    const withEmptyApk = fs.mkdtempSync(path.join(os.tmpdir(), 'termix-empty-apk-'));
    t.after(() => fs.rmSync(withEmptyApk, { recursive: true, force: true }));
    fs.writeFileSync(path.join(withEmptyApk, 'app-arm64-v8a-debug.apk'), '');
    const { options: opt2 } = fixture(t);
    opt2.apkPath = withEmptyApk;
    await assert.rejects(publishApk(opt2), /Android APK is empty/);
});

test('APK publishing rejects upload if any split APK asset already exists on release', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'termix-split-collision-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    fs.writeFileSync(path.join(directory, 'app-arm64-v8a-debug.apk'), 'arm64');
    fs.writeFileSync(path.join(directory, 'app-x86_64-debug.apk'), 'x86_64');

    const calls = [];
    const options = {
        apkPath: directory,
        context: { repo: { owner: 'test-owner', repo: 'test-repo' } },
        runNumber: '12',
        log: () => {},
        github: {
            rest: { repos: {
                async getLatestRelease() {
                    return { data: { id: 42, tag_name: 'v1.0.60', draft: false, prerelease: false } };
                },
                listReleaseAssets: () => {},
                async uploadReleaseAsset(parameters) {
                    calls.push(parameters);
                }
            } },
            async paginate() {
                return [...desktopNames, 'Termix-android-v1.0.60.12-x86_64.apk'].map(name => ({ name, size: 100 }));
            }
        }
    };

    await assert.rejects(publishApk(options), /Termix-android-v1\.0\.60\.12-x86_64\.apk.*existing assets will not be replaced/);
    assert.equal(calls.length, 0, 'No files should be uploaded if any asset already exists');
});
