const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

module.exports = async function () {
    // Path to where profiles are stored: ../profiles/profiles relative to this file
    const profilesDir = path.resolve(__dirname, '..', 'profiles', 'profiles');
    
    if (!fs.existsSync(profilesDir)) {
         fs.mkdirSync(profilesDir, { recursive: true });
    }

    exec(`explorer "${profilesDir}"`);
    
    return { success: true };
};
