const db = require('../../util/profile-db');
const { decrypt } = require('../../util/crypto');

module.exports = async (path) => {
    const raw = db.get('hosts');
    const data = Array.isArray(raw) ? raw : [];

    return data.map((item) => {
        const next = item && typeof item === 'object' ? { ...item } : {};
        if (next.password) next.password = decrypt(next.password);
        return next;
    });
};

