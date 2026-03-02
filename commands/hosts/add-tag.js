const db = require('../../util/profile-db');

module.exports = async (filesPath, tag) => {
    return db.push('tags', tag);
};

