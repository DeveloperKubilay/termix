const db = require('../../util/profile-db');

module.exports = () => {
    return db.get('terminalSettings');
};

