const db = require('../../util/profile-db');
const {
    normalizeSftpSettings,
    normalizeUpdateSettings,
    normalizeUiTheme
} = require('../../util/profile-defaults');

module.exports = async function () {
    const ai = db.get("ai") || { method: 'GET', url: '', body: {}, headers: {} };
    const updateSettings = normalizeUpdateSettings(db.get('updateSettings'));
    const sftpSettings = normalizeSftpSettings(db.get('sftpSettings'));
    const uiTheme = normalizeUiTheme(db.get('uiTheme'));
    const type = db.get("type") || "local";
    const name = db.get("name") || "Unknown";
    const tags = db.get("tags") || [];
    
    return {
        ai,
        updateSettings,
        sftpSettings,
        uiTheme,
        profile: {
            type,
            name
        },
        tags
    };
};

