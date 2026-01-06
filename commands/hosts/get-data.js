const kubitdb = require('kubitdb');
const db = new kubitdb();
const { decrypt } = require('../../util/crypto');

module.exports = async (path) => {

    //sconsole.log(filter)
    let data = //filter ? db.get('hosts').find(z=>z.id == filter) : 
    db.get('hosts'); 

    data = data.map(item => {
        if(item.password) item.password = decrypt(item.password);
        return item;
    })

    return data;
};
