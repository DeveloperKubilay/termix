const db = require('../../util/profile-db');

module.exports = (_, targetHost) => {
    try {
        let hosts = db.get("knownHosts");
        if (!Array.isArray(hosts)) return { success: false, message: "No hosts found" };

        const initialLength = hosts.length;
        // Loose comparison for port (string vs number)
        hosts = hosts.filter(h => !(h.address === targetHost.address && h.port == targetHost.port));

        if (hosts.length === initialLength) {
            // Debug info if needed
            return { success: false, message: `Host not found (${targetHost.address}:${targetHost.port})` };
        }

        db.set("knownHosts", hosts);
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
};

