const { exec } = require('child_process');
const fs = require('fs');
const profileManager = require('../../util/profile-manager');

module.exports = async function () {
    const profilesDir = profileManager.paths.profilesDir;
    
    if (!fs.existsSync(profilesDir)) {
         fs.mkdirSync(profilesDir, { recursive: true });
    }

    exec(`explorer "${profilesDir}"`);
    
    return { success: true };
};
