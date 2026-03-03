const db = require('../../util/profile-db');
const { normalizeUpdateSettings } = require('../../util/profile-defaults');

module.exports = async function () {
    const ai = db.get("ai") || { method: 'GET', url: '', body: {}, headers: {} };
    const updateSettings = normalizeUpdateSettings(db.get('updateSettings'));
    const type = db.get("type") || "local";
    const name = db.get("name") || "Unknown";
    const tags = db.get("tags") || [];
    
    return {
        ai,
        updateSettings,
        profile: {
            type,
            name
        },
        tags
    };
};

