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
        context: { repo: { owner: 'test-owner', repo: 'test-repo' }, runId: 123, sha: 'a'.repeat(40) },
        runAttempt: '2',
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
        tag: 'v1.0.60', name: 'Termix-android-preview-aaaaaaaaaaaa-123-2-arm64-v8a-x86_64.apk'
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
        names: [...desktopNames, 'Termix-android-preview-aaaaaaaaaaaa-123-2-arm64-v8a-x86_64.apk']
    });
    await assert.rejects(publishApk(options), /existing assets will not be replaced/);
    assert.ok(calls.every(call => call.method !== 'uploadReleaseAsset'));
});

test('APK publishing rejects invalid build identities', async t => {
    for (const identity of [{ runId: undefined }, { sha: 'invalid' }, { runAttempt: undefined }]) {
        const { calls, options } = fixture(t);
        if ('runId' in identity) options.context.runId = identity.runId;
        if ('sha' in identity) options.context.sha = identity.sha;
        if ('runAttempt' in identity) options.runAttempt = '';
        await assert.rejects(publishApk(options), /build identity/);
        assert.ok(calls.every(call => call.method !== 'uploadReleaseAsset'));
    }
});
