const kubitdb = require('kubitdb');
const db = new kubitdb();

module.exports = () => {
    return db.get('terminalSettings');
};
