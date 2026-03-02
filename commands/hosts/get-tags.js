const db = require('../../util/profile-db');

module.exports = async (filesPath) => {
    return db.get('tags') || [];
};

