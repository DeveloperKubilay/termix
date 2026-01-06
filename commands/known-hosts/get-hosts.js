const kubitdb = require('kubitdb');
const db = new kubitdb();

module.exports = () => {
    try {
        const hosts = db.get("knownHosts");
        return Array.isArray(hosts) ? hosts : [];
    } catch (e) {
        return [];
    }
};
