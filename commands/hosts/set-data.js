const kubitdb = require('kubitdb');
const db = new kubitdb();
const { encrypt } = require('../../util/crypto');

module.exports = async (filesPath, data) => {

    data = data.map(item =>{
        if(item.password) item.password = encrypt(item.password || "");
        return item;
    })

    return db.set('hosts', data);
};
