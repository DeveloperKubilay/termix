const kubitdb = require('kubitdb');
const db = new kubitdb();

module.exports = async function () {
    const ai = db.get("ai") || { method: 'GET', url: '', headers: '' };
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
