const path = require('path');
const os = require('os');
const fs = require('fs');

let electron = null;
try {
    electron = require('electron');
} catch (_) {}

const ASAR_ROOT = path.resolve(__dirname, '..');

function getDefaultUserDataPath() {
    const homedir = os.homedir();
    if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(homedir, 'AppData', 'Roaming');
        return path.join(appData, 'Termix');
    }
    if (process.platform === 'darwin') {
        return path.join(homedir, 'Library', 'Application Support', 'Termix');
    }
    return process.env.XDG_CONFIG_HOME
        ? path.join(process.env.XDG_CONFIG_HOME, 'Termix')
        : path.join(homedir, '.config', 'Termix');
}

function resolveDataRoot() {
    const app = electron && electron.app;
    if (app && typeof app.getPath === 'function') {
        return app.isPackaged ? app.getPath('userData') : ASAR_ROOT;
    }

    if (ASAR_ROOT.includes('app.asar')) {
        return getDefaultUserDataPath();
    }

    if (fs.existsSync(path.join(ASAR_ROOT, 'profiles'))) {
        return ASAR_ROOT;
    }

    const defaultPath = getDefaultUserDataPath();
    if (fs.existsSync(defaultPath)) {
        return defaultPath;
    }

    return ASAR_ROOT;
}

const DATA_ROOT = resolveDataRoot();

module.exports = {
    ASAR_ROOT,
    DATA_ROOT,
    PROFILES_DIR: path.join(DATA_ROOT, 'profiles'),
    FILES_DIR: path.join(DATA_ROOT, 'files'),
    COMMANDS_DIR: path.join(ASAR_ROOT, 'commands'),
};
