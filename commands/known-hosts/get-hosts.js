const db = require('../../util/profile-db');

module.exports = () => {
    try {
        const hosts = db.get("knownHosts");
        return Array.isArray(hosts) ? hosts : [];
    } catch (e) {
        return [];
    }
};

