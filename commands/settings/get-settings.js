const db = require('../../util/profile-db');

module.exports = async function () {
    const ai = db.get("ai") || { method: 'GET', url: '', body: {}, headers: {} };
    const type = db.get("type") || "local";
    const name = db.get("name") || "Unknown";
    const tags = db.get("tags") || [];
    
    return {
        ai,
        profile: {
            type,
            name
        },
        tags
    };
};

