const firebase = require('../../util/firebase');
const kubitdb = require('kubitdb');
const db = new kubitdb();

module.exports = async function (filesPath, action) {
    const type = db.get("type");
    
    if (type !== 'firebase') {
        throw new Error("Only available for Firebase users.");
    }
    
    try {
        if (action === 'push') {
            await firebase(true);
            return { success: true, message: "Data pushed to Firebase successfully." };
        } else {
            // Pull
            await firebase(false);
            // After pulling, the kubitdb.json is updated.
            return { success: true, message: "Data fetched from Firebase successfully." };
        }
    } catch (err) {
        console.error(err);
        return { success: false, message: "Sync failed: " + err.message };
    }
};
