const fs = require('fs');
const path = require('path');
const firebase = require('../../util/firebase');
const startDb = require('../../util/startDb');

module.exports = async function (newdb) {
    try {
        const olddata = db.all()
        if (!olddata.name) return;
        const rootDir = path.resolve(__dirname, "profiles", olddata.name + ".json");
        if (olddata.type === "firebase" && olddata.write) {
            await firebase(true)
        }
        else
            fs.writeFileSync(rootDir, JSON.stringify(olddata, null, 4), 'utf-8');

        const newdbPath = path.resolve(__dirname, "profiles", newdb + ".json");
        const newdb = new kubitdb(newdbPath);
        if (newdb.get("type") === "firebase") {
            fs.writeFileSync(path.resolve(__dirname, 'kubitdb.json'), JSON.stringify(newdb.all(), null, 4), 'utf-8');
            await firebase()
            startDb();
            return;
        }

        fs.copyFileSync(newdbPath, path.resolve(__dirname, 'kubitdb.json'));
        startDb();
    } catch {
        return { success: false, message: `An error occurred while switching profile.` };
    }
};
