const fs = require('fs');
const path = require('path');
const { shell } = require('electron');
const profileManager = require('../../util/profile-manager');

module.exports = async function () {
    const { activeProfile } = profileManager.ensureInitialized();

    if (!activeProfile || !activeProfile.id) {
        throw new Error('No active profile found.');
    }

    const configPath = path.join(profileManager.paths.profilesDir, `${activeProfile.id}.json`);

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
