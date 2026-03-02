const kubitdb = require('kubitdb');
const db = new kubitdb();
const { encrypt } = require('../../util/crypto');
const SSH_PORT_MIN = 1;
const SSH_PORT_MAX = 65535;
const SSH_PORT_DEFAULT = 22;

function normalizeSshPort(value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < SSH_PORT_MIN || parsed > SSH_PORT_MAX) {
        return String(SSH_PORT_DEFAULT);
    }
    return String(parsed);
}

module.exports = async (filesPath, data) => {

    data = data.map((item) => {
        const next = { ...item };
        if (next.password) next.password = encrypt(next.password || "");

        const protocol = String(next.protocol || 'SSH').toUpperCase();
        if (protocol === 'SSH' || protocol === 'SFTP') {
            next.port = normalizeSshPort(next.port);
        }

        return next;
    });

    return db.set('hosts', data);
};
