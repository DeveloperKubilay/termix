'use strict';

const fs = require('node:fs');
const path = require('node:path');

function formatReleaseAssetName(version, runNumber, filePath) {
    const basename = path.basename(filePath);
    const match = /(?:^|[-_.])(arm64-v8a|x86_64|armeabi-v7a|x86)(?:[-_.]|$)/i.exec(basename);
    if (match) {
        return `Termix-android-v${version}.${runNumber}-${match[1].toLowerCase()}.apk`;
    }
    return `Termix-android-v${version}.${runNumber}.apk`;
}

function resolveApkFiles({ apkPath, apkPaths }) {
    if (Array.isArray(apkPaths) && apkPaths.length > 0) {
        return apkPaths;
    }
    if (!apkPath) throw new Error('Missing Android APK path.');
    if (fs.existsSync(apkPath) && fs.statSync(apkPath).isDirectory()) {
        const found = fs.readdirSync(apkPath)
            .filter(name => name.endsWith('.apk'))
            .sort()
            .map(name => path.join(apkPath, name));
        if (!found.length) throw new Error('Android APK directory contains no APK files.');
        return found;
    }
    return [apkPath];
}

async function publishApk({ github, context, apkPath, apkPaths, runNumber = process.env.GITHUB_RUN_NUMBER, log = console.log }) {
    const files = resolveApkFiles({ apkPath, apkPaths });
    const toUpload = files.map(file => {
        const data = fs.readFileSync(file);
        if (!data.length) throw new Error(`Android APK is empty: ${path.basename(file)}`);
        return { file, data };
    });

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

    for (const item of toUpload) {
        item.name = formatReleaseAssetName(version[1], runNumber, item.file);
        if (assets.some(asset => asset.name === item.name)) {
            throw new Error(`Release already contains ${item.name}; existing assets will not be replaced.`);
        }
    }

    for (const item of toUpload) {
        await github.rest.repos.uploadReleaseAsset({
            owner, repo, release_id: release.id, name: item.name,
            data: item.data,
            headers: { 'content-type': 'application/vnd.android.package-archive' }
        });
        log(`Added ${item.name} to existing release ${release.tag_name}. Desktop assets and release settings were not changed.`);
    }

    const uploadedNames = toUpload.map(item => item.name);
    const result = { tag: release.tag_name, name: uploadedNames[0] };
    if (uploadedNames.length > 1) {
        result.names = uploadedNames;
    }
    return result;
}

module.exports = { publishApk, formatReleaseAssetName };
