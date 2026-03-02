const fs = require('fs');
const { shell } = require('electron');
const profileManager = require('../../util/profile-manager');

module.exports = async function () {
    const configPath = profileManager.getActiveProfileFilePath();
    if (!configPath) {
        throw new Error('No active profile found.');
    }

    if (!fs.existsSync(configPath)) {
        throw new Error(`Config file not found: ${configPath}`);
    }

    const openError = await shell.openPath(configPath);
    if (openError) {
        throw new Error(openError);
    }

    return {
        success: true,
        path: configPath
    };
};
