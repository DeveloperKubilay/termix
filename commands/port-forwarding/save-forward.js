const kubitdb = require('kubitdb');

const db = new kubitdb();

function getArray(key) {
    const value = db.get(key);
    return Array.isArray(value) ? value : [];
}

function normalizeHost(value, fallback = '127.0.0.1') {
    const out = String(value || '').trim();
    return out || fallback;
}

function normalizePort(value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
        return null;
    }
    return parsed;
}

module.exports = async (filesPath, payload = {}) => {
    try {
        const forwards = getArray('portForwards');
        const hosts = getArray('hosts');

        const selectedHost = hosts.find((host) => String(host.id) === String(payload.hostId));
        if (!selectedHost) {
            return { success: false, message: 'Please select a valid VDS host.' };
        }

        const remoteHost = normalizeHost(payload.remoteHost, '127.0.0.1');
        const localHost = normalizeHost(payload.localHost, '127.0.0.1');
        const remotePort = normalizePort(payload.remotePort);
        const localPort = normalizePort(payload.localPort);

        if (!remotePort) {
            return { success: false, message: 'Remote port must be between 1 and 65535.' };
        }

        if (!localPort) {
            return { success: false, message: 'Local port must be between 1 and 65535.' };
        }

        const now = Date.now();
        const generatedId = now + Math.floor(Math.random() * 1000);
        const id = payload.id ? Number(payload.id) : generatedId;

        if (!Number.isFinite(id)) {
            return { success: false, message: 'Forward id is invalid.' };
        }

        const conflict = forwards.find((item) => {
            if (String(item.id) === String(id)) return false;
            return normalizeHost(item.localHost, '127.0.0.1') === localHost && Number(item.localPort) === localPort;
        });

        if (conflict) {
            return {
                success: false,
                message: 'This local host/port is already used by another forward.'
            };
        }

        const existingIndex = forwards.findIndex((item) => String(item.id) === String(id));
        const createdAt = existingIndex >= 0 ? Number(forwards[existingIndex].createdAt || now) : now;

        const nextForward = {
            id,
            hostId: selectedHost.id,
            remoteHost,
            remotePort,
            localHost,
            localPort,
            createdAt,
            updatedAt: now
        };

        if (existingIndex >= 0) {
            forwards[existingIndex] = nextForward;
        } else {
            forwards.push(nextForward);
        }

        db.set('portForwards', forwards);

        return {
            success: true,
            forward: nextForward
        };
    } catch (err) {
        return {
            success: false,
            message: err && err.message ? err.message : String(err)
        };
    }
};
