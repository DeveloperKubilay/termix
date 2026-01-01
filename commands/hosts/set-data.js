const kubitdb = require('kubitdb');
const db = new kubitdb();

module.exports = async (filesPath, data) => {
    return db.set('hosts', data);
};
