const fs = require('fs');
const path = require('path');

module.exports = async function (filesPath, data) {
    const profilesDir = path.join(__dirname, 'profiles');

    if (!fs.existsSync(profilesDir)) {
        fs.mkdirSync(profilesDir, { recursive: true });
    }

    const { name, type, config } = data;

    const writeFlag = (typeof data.write !== 'undefined') ? data.write : (data.permissions && typeof data.permissions.write !== 'undefined') ? data.permissions.write : true;

    if (!name) {
        throw new Error('Profile name is required');
    }

    const fileName = `${name}.json`;
    const filePath = path.join(profilesDir, fileName);

    if (fs.existsSync(filePath)) {
        throw new Error(`Profile '${name}' already exists.`);
    }

    let profileData = {
        name,
        type,
        usedAt: new Date().toISOString(),
        write: type === 'firebase' ? !!writeFlag : true
    };

    if (type == "firebase") {
        profileData = {
            ...profileData,
            config: config || {}
        };
    }

    fs.writeFileSync(filePath, JSON.stringify(profileData, null, 4), 'utf-8');

    return { success: true, message: `User '${name}' created successfully.` };
};
