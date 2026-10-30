'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const TARGET = path.join(ROOT, 'android/app/src/main/assets');
const DEPENDENCIES = path.join(__dirname, 'node_modules');
const WEB_PACKAGES = [
    '@fontsource/jetbrains-mono', '@fortawesome/fontawesome-free',
    'xterm', 'xterm-addon-fit', 'xterm-addon-unicode11', 'xterm-addon-webgl', 'markdown-it'
];
const BACKEND_UTILS = [
    'paths.js', 'crypto.js', 'profile-db.js', 'profile-manager.js', 'profile-defaults.js',
    'profile-secrets.js', 'cloud-sync.js', 'connections/ssh.js', 'connections/ssh-common.js',
    'sftp/manager.js', 'sftp/tar-transfer.js', 'sftp/exclude.js'
];
const COMMAND_GROUPS = ['hosts', 'profiles', 'settings', 'connection', 'keychain', 'known-hosts', 'snippets', 'sftp'];

function copy(source, destination) {
    if (!fs.existsSync(source)) throw new Error(`Missing Android input: ${path.relative(ROOT, source)}`);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.cpSync(source, destination, {
        recursive: true,
        dereference: false,
        filter: (entry) => {
            const stat = fs.lstatSync(entry);
            if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic link in Android bundle: ${entry}`);
            return !entry.endsWith('.node') && !entry.includes(`${path.sep}.bin${path.sep}`);
        }
    });
}

function backendPackages() {
    const names = new Set();
    const lock = JSON.parse(fs.readFileSync(path.join(__dirname, 'package-lock.json'), 'utf8'));
    function visit(name) {
        if (names.has(name)) return;
        const info = lock.packages[`node_modules/${name}`];
        if (!info || info.link) throw new Error(`Missing locked portable dependency: ${name}`);
        names.add(name);
        Object.keys(info.dependencies || {}).forEach(visit);
    }
    visit('ssh2');
    visit('tar');
    return [...names].sort();
}

function digestTree(directory, digest = crypto.createHash('sha256')) {
    for (const name of fs.readdirSync(directory).sort()) {
        const file = path.join(directory, name);
        const stat = fs.statSync(file);
        digest.update(name);
        if (stat.isDirectory()) digestTree(file, digest);
        else digest.update(fs.readFileSync(file));
    }
    return digest;
}

function prepare() {
    const stage = `${TARGET}.staging`;
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    try {
        const web = path.join(stage, 'web');
        copy(path.join(ROOT, 'public'), path.join(web, 'public'));
        for (const name of WEB_PACKAGES) copy(path.join(DEPENDENCIES, name), path.join(web, 'node_modules', name));
        let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
        html = html.replace('<html lang="en">', '<html lang="en" data-platform="android">');
        html = html.replace('width=device-width, initial-scale=1.0', 'width=device-width, initial-scale=1.0, viewport-fit=cover');
        html = html.replace('</head>', '    <link rel="stylesheet" href="public/android/mobile.css">\n</head>');
        html = html.replace(/    <script src="public\/modules\/ai\/ai\.js"><\/script>\s*<script src="public\/app\.js"><\/script>/,
            '    <script src="public/android/bridge.js"></script>\n    <script src="public/android/start.js"></script>');
        if (!html.includes('public/android/start.js')) throw new Error('Android boot injection did not match index.html');
        fs.writeFileSync(path.join(web, 'index.html'), html);

        const backend = path.join(stage, 'backend');
        for (const file of BACKEND_UTILS) copy(path.join(ROOT, 'util', file), path.join(backend, 'util', file));
        copy(path.join(__dirname, 'backend'), path.join(backend, 'util/android/backend'));
        for (const group of COMMAND_GROUPS) copy(path.join(ROOT, 'commands', group), path.join(backend, 'commands', group));
        for (const name of backendPackages()) copy(path.join(DEPENDENCIES, name), path.join(backend, 'node_modules', name));
        fs.writeFileSync(path.join(backend, 'bootstrap.js'), "'use strict';\nrequire('./util/android/backend/bootstrap');\n");
        fs.writeFileSync(path.join(backend, 'package.json'), JSON.stringify({ name: 'termix-android-backend', private: true, version: '0.1.0' }));
        const version = digestTree(stage).digest('hex');
        fs.writeFileSync(path.join(stage, 'bundle-version.txt'), version);
        fs.mkdirSync(path.dirname(TARGET), { recursive: true });
        fs.rmSync(TARGET, { recursive: true, force: true });
        fs.renameSync(stage, TARGET);
        console.log(`Android assets prepared (${version.slice(0, 12)}); no desktop native addons or user profiles bundled.`);
    } catch (error) {
        fs.rmSync(stage, { recursive: true, force: true });
        throw error;
    }
}

if (require.main === module) prepare();
module.exports = { prepare, backendPackages };
