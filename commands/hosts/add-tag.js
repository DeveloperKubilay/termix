const kubitdb = require('kubitdb');
const db = new kubitdb();

module.exports = async (filesPath, tag) => {
    return db.push('tags', tag);
};
