const { exec } = require('child_process');
const fs = require('fs');
const profileManager = require('../../util/profile-manager');

module.exports = async function () {
    const profilesDir = profileManager.paths.profilesDir;
    
    if (!fs.existsSync(profilesDir)) {
         fs.mkdirSync(profilesDir, { recursive: true });
    }

    const platform = process.platform;
    let command;

    if (platform === 'win32') {
        command = `explorer "${profilesDir}"`;
    } else if (platform === 'darwin') {
        command = `open "${profilesDir}"`;
    } else {
        command = `xdg-open "${profilesDir}"`;
    }

    exec(command, (error) => {
        if (error) {
            // explorer on Windows exits with code 1 even on success; ignore that
            if (platform === 'win32' && error.code === 1) return;
            console.error('Failed to open folder:', error);
        }
    });

    return { success: true };
};
