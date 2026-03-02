const db = require('../../util/profile-db');

module.exports = async (filesPath, hostId, fontSize) => {
    if (hostId == null) {
        return { success: false, message: 'Host id is required.' };
    }

    const parsedSize = Number(fontSize);
    if (!Number.isFinite(parsedSize) || parsedSize < 6) {
        return { success: false, message: 'Font size must be a number greater than or equal to 6.' };
    }

    const hosts = db.get('hosts');
    if (!Array.isArray(hosts)) {
        return { success: false, message: 'Hosts list not found.' };
    }

    const normalizedId = String(hostId);
    const index = hosts.findIndex((host) => String(host.id) === normalizedId);
    if (index === -1) {
        return { success: false, message: 'Host not found.' };
    }

    const normalizedFontSize = Math.round(parsedSize * 10) / 10;
    hosts[index] = {
        ...hosts[index],
        terminalFontSize: normalizedFontSize
    };

    db.set('hosts', hosts);

    return {
        success: true,
        hostId: hosts[index].id,
        terminalFontSize: normalizedFontSize
    };
};

