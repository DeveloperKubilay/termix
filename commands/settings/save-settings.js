const db = require('../../util/profile-db');

module.exports = async function (filesPath, settings) {
    if (settings.ai) {
        db.set("ai", settings.ai);
    }
    return { success: true };
};

