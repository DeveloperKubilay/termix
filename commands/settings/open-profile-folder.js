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
        if (error && error.code !== 1) { // exit code 1 from explorer is normal on Windows
            console.error('Failed to open folder:', error);
        }
    });

    return { success: true };
};
