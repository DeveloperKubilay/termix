var firebase = require("firebase/app");
var firestore = require("firebase/firestore");
const kubitdb = require('kubitdb');
const db = new kubitdb();


async function getDir(collectionName) {
    let querySnapshot = await firestore.getDocs(firestore.collection(db, collectionName));
    if (querySnapshot.empty) return db.clear()
    querySnapshot = querySnapshot.map(doc => doc.data());
}

async function removeDir(collectionName) {
    let querySnapshot = await firestore.getDocs(firestore.collection(db, collectionName));
    if (querySnapshot.empty) return;
    for (const doc of querySnapshot) {
        await firestore.deleteDoc(firestore.doc(db, collectionName, doc.id));
    }
}

async function pushDir(collectionName, data) {
    for (const item of data) {
        await firestore.addDoc(firestore.collection(db, collectionName), item)
    }
}

module.exports = async function (upload) {
    try {
        const dbProfile = db.get("config");
        const write = db.get("write") || false;

        var app = firebase.initializeApp(dbProfile);
        var db = firestore.getFirestore(app);

        if (upload) {
            await removeDir(dbProfile.collectionName || "vms")
            await removeDir(dbProfile.tagsCollectionName || "tags")

            await pushDir(dbProfile.collectionName || "vms", db.get("vms") || [])
            await pushDir(dbProfile.tagsCollectionName || "tags", db.get("tags") || [])
            return;
        }

        const vms = await getDir(dbProfile.collectionName || "vms")
        const tags = await getDir(dbProfile.tagsCollectionName || "tags")

        db.clear()
        db.set("type", "firebase")
        db.set("write", write)
        db.set("vms", vms)
        db.set("tags", tags)
    } catch {
        return -1
    }
}