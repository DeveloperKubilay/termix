const kubitdb = require('kubitdb');
const manager = require('../../util/port-forwarding/manager');

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

function normalizeDirection(value) {
    const direction = String(value || '').trim().toLowerCase();
    return direction === 'local_to_remote' ? 'local_to_remote' : 'remote_to_local';
}

module.exports = async (filesPath, payload = {}) => {
    try {
        const hosts = getArray('hosts');

        const selectedHost = hosts.find((host) => String(host.id) === String(payload.hostId));
        if (!selectedHost) {
            return { success: false, message: 'Please select a valid VDS host.' };
        }

        const remoteHost = normalizeHost(payload.remoteHost, '127.0.0.1');
        const localHost = normalizeHost(payload.localHost, '127.0.0.1');
        const remotePort = normalizePort(payload.remotePort);
        const localPort = normalizePort(payload.localPort);
        const direction = normalizeDirection(payload.direction);

        if (!remotePort) {
            return { success: false, message: 'Remote port must be between 1 and 65535.' };
        }

        if (!localPort) {
            return { success: false, message: 'Local port must be between 1 and 65535.' };
        }

        const id = payload.id ? Number(payload.id) : undefined;

        if (payload.id != null && !Number.isFinite(id)) {
            return { success: false, message: 'Forward id is invalid.' };
        }

        const conflict = manager.hasPortConflict({
            direction,
            hostId: selectedHost.id,
            remoteHost,
            remotePort,
            localHost,
            localPort
        }, id);

        if (conflict) {
            return {
                success: false,
                message: direction === 'remote_to_local'
                    ? 'This remote host/port is already used on this VDS.'
                    : 'This local host/port is already used by another forward.'
            };
        }

        const nextForward = manager.saveForward({
            id,
            hostId: selectedHost.id,
            direction,
            remoteHost,
            remotePort,
            localHost,
            localPort
        });

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
