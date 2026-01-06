const kubitdb = require('kubitdb');
const db = new kubitdb();

module.exports = async function (filesPath, settings) {
    if (settings.ai) {
        db.set("ai", settings.ai);
    }
    return { success: true };
};
