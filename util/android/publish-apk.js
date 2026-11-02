'use strict';

const fs = require('node:fs');

async function publishApk({ github, context, apkPath, runNumber = process.env.GITHUB_RUN_NUMBER, log = console.log }) {
    const apk = fs.readFileSync(apkPath);
    if (!apk.length) throw new Error('Android APK is empty.');

    const { owner, repo } = context.repo;
    const { data: release } = await github.rest.repos.getLatestRelease({ owner, repo });
    if (release.draft || release.prerelease) throw new Error('Latest release must be a published stable desktop release.');

    const assets = await github.paginate(github.rest.repos.listReleaseAssets, {
        owner, repo, release_id: release.id, per_page: 100
    });
    const names = new Set(assets.filter(asset => asset.size > 0).map(asset => asset.name));
    for (const name of ['latest.yml', 'latest-linux.yml', 'latest-mac.yml']) {
        if (!names.has(name)) throw new Error(`Desktop release is missing ${name}; APK was not published.`);
    }
    for (const extension of ['.exe', '.AppImage', '.dmg']) {
        if (![...names].some(name => name.endsWith(extension))) {
            throw new Error(`Desktop release is missing a ${extension} package; APK was not published.`);
        }
    }

    const version = /^v?((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))$/.exec(release.tag_name || '');
    if (!version) throw new Error('Desktop release tag must be a stable numeric version.');
    if (!/^[1-9]\d*$/.test(String(runNumber))) {
        throw new Error('Missing or invalid Android build number.');
    }
    const name = `Termix-android-v${version[1]}.${runNumber}.apk`;
    if (assets.some(asset => asset.name === name)) {
        throw new Error(`Release already contains ${name}; existing assets will not be replaced.`);
    }

    await github.rest.repos.uploadReleaseAsset({
        owner, repo, release_id: release.id, name,
        data: apk,
        headers: { 'content-type': 'application/vnd.android.package-archive' }
    });
    log(`Added ${name} to existing release ${release.tag_name}. Desktop assets and release settings were not changed.`);
    return { tag: release.tag_name, name };
}

module.exports = { publishApk };
