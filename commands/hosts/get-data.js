const kubitdb = require('kubitdb');
const db = new kubitdb();
const { decrypt } = require('../../util/crypto');

module.exports = async (path) => {

    let data = db.get('hosts');

    data = data.map(item => {
        if(item.password) item.password = decrypt(item.password);
        return item;
    })

    return data;
};
