const kubitdb = require('kubitdb');
const manager = require('../../util/port-forwarding/manager');

const db = new kubitdb();

function getArray(key) {
    const value = db.get(key);
    return Array.isArray(value) ? value : [];
}

function mapHost(host) {
    if (!host) return null;
    return {
        id: host.id,
        name: host.name || host.address || 'Unnamed',
        address: host.address || '',
        username: host.username || 'root',
        icon: host.icon || 'fa-solid fa-server',
        color: host.color || '#89b4fa'
    };
}

module.exports = async () => {
    const forwards = manager.listForwards();
    const hosts = getArray('hosts');

    return forwards
        .map((forward) => {
            const host = hosts.find((item) => String(item.id) === String(forward.hostId));
            return {
                ...forward,
                host: mapHost(host),
                runtime: manager.getForwardState(forward.id)
            };
        })
        .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
};
