const path = require('path');
const electron = require('electron');

const ASAR_ROOT = path.resolve(__dirname, '..');

function resolveDataRoot() {
    const app = electron && electron.app;
    if (app && typeof app.getPath === 'function') {
        return app.isPackaged ? app.getPath('userData') : ASAR_ROOT;
    }

    // Preload/renderer can import this module while electron.app is unavailable.
    // Fall back to workspace root to keep channel discovery working.
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
