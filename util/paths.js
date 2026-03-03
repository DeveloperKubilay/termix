const path = require('path');
const { app } = require('electron');

const ASAR_ROOT = path.resolve(__dirname, '..');
const DATA_ROOT = app.isPackaged ? app.getPath('userData') : ASAR_ROOT;

module.exports = {
    ASAR_ROOT,
    DATA_ROOT,
    PROFILES_DIR: path.join(DATA_ROOT, 'profiles'),
    FILES_DIR: path.join(DATA_ROOT, 'files'),
    COMMANDS_DIR: path.join(ASAR_ROOT, 'commands'),
};
