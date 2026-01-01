const kubitdb = require('kubitdb');
const db = new kubitdb();

module.exports = async (filesPath) => {
    return db.get('tags') || [];
};
