const firebase = require('../../util/firebase');
const db = require('../../util/profile-db');
const profileManager = require('../../util/profile-manager');

module.exports = async function (filesPath, action) {
    const type = db.get("type");
    
    if (type !== 'firebase') {
        throw new Error("Only available for Firebase users.");
    }

    if (action !== 'push' && action !== 'pull') {
        throw new Error("Invalid action. Use 'push' or 'pull'.");
    }
    
    try {
        if (action === 'push') {
            await firebase(true);
            profileManager.persistActiveProfileData();
            return { success: true, message: "Data pushed to Firebase successfully." };
        } else {
            await firebase(false);
            profileManager.persistActiveProfileData();
            return { success: true, message: "Data fetched from Firebase successfully." };
        }
    } catch (err) {
        console.error(err);
        return { success: false, message: "Sync failed: " + err.message };
    }
};

