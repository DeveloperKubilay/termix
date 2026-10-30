'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const metadata = require('./runtime.json');
const ROOT = path.resolve(__dirname, '../..');
const target = path.join(ROOT, 'android/runtime');

async function prepare() {
    if (!process.argv.includes('--allow-eol-preview')) {
        throw new Error('The pinned Node runtime is EOL and not 16 KB-compatible. For a development-only APK, explicitly pass --allow-eol-preview. See util/android/runtime.json.');
    }
    if (fs.existsSync(path.join(target, 'provenance.json'))) {
        const current = JSON.parse(fs.readFileSync(path.join(target, 'provenance.json'), 'utf8'));
        if (current.sha256 !== metadata.sha256) throw new Error('Existing runtime provenance differs. Inspect android/runtime before replacing it.');
        for (const abi of metadata.abis) {
            if (!fs.existsSync(path.join(target, 'bin', abi, 'libnode.so'))) throw new Error(`Cached runtime missing ABI ${abi}`);
        }
        console.warn(metadata.warning);
        console.log('Using previously verified runtime archive.');
        return;
    }
    if (fs.existsSync(target) && fs.readdirSync(target).length) {
        throw new Error('android/runtime already contains files without verified provenance. Inspect or move that directory before preparing a new runtime.');
    }
    // Downloads and extraction each get their own fresh directory. Run no code from either.
    const downloadDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'termix-node-download-'));
    const extractionDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'termix-node-extract-'));
    const archive = path.join(downloadDirectory, 'runtime.zip');
    console.log(`Downloading pinned Node ${metadata.version} Android development runtime.`);
    const response = await fetch(metadata.url);
    if (!response.ok) throw new Error(`Runtime download failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== metadata.size || crypto.createHash('sha256').update(bytes).digest('hex') !== metadata.sha256) {
        throw new Error('Runtime archive size or SHA-256 verification failed.');
    }
    fs.writeFileSync(archive, bytes);
    const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
    const result = spawnSync(python, ['-I', path.join(__dirname, 'extract-runtime.py'), archive, extractionDirectory], {
        cwd: ROOT, stdio: 'inherit'
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Runtime archive extraction failed.');
    for (const abi of metadata.abis) {
        if (!fs.existsSync(path.join(extractionDirectory, 'bin', abi, 'libnode.so'))) throw new Error(`Runtime archive missing ABI ${abi}`);
    }
    if (!fs.existsSync(path.join(extractionDirectory, 'include/node/node.h'))) throw new Error('Runtime archive missing Node headers.');
    fs.mkdirSync(target, { recursive: true });
    fs.cpSync(extractionDirectory, target, { recursive: true });
    fs.writeFileSync(path.join(target, 'provenance.json'), JSON.stringify(metadata, null, 2) + '\n');
    console.warn(metadata.warning);
    console.log('Native runtime prepared and SHA-256 verified.');
}

if (require.main === module) prepare().catch((error) => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepare };
