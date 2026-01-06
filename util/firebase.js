var firebase = require("firebase/app");
var firestore = require("firebase/firestore");
const kubitdb = require('kubitdb');
const db = new kubitdb();


async function getDir(db, collectionName) {
    let querySnapshot = await firestore.getDocs(firestore.collection(db, collectionName));
    if (querySnapshot.empty) return []
    return querySnapshot.docs.map(doc => doc.data());
}

async function removeDir(db, collectionName) {
    let querySnapshot = await firestore.getDocs(firestore.collection(db, collectionName));
    if (querySnapshot.empty) return;
    for (const doc of querySnapshot.docs) {
        await firestore.deleteDoc(firestore.doc(db, collectionName, doc.id));
    }
}

async function pushDir(db, collectionName, data) {
    for (const item of data) {
        await firestore.addDoc(firestore.collection(db, collectionName), item)
    }
}

module.exports = async function (upload) {
    try {
        const dbProfile = db.get("config");
        const write = db.get("write") || false;

        var app = firebase.initializeApp(dbProfile);
        var firestoreDb = firestore.getFirestore(app);

        if (upload) {
            await removeDir(firestoreDb, dbProfile.collectionName || "vms")
            await removeDir(firestoreDb, dbProfile.tagsCollectionName || "tags")

            await pushDir(firestoreDb, dbProfile.collectionName || "vms", db.get("vms") || [])
            await pushDir(firestoreDb, dbProfile.tagsCollectionName || "tags", db.get("tags") || [])
            return;
        }

        const vms = await getDir(firestoreDb, dbProfile.collectionName || "vms")
        const tags = await getDir(firestoreDb, dbProfile.tagsCollectionName || "tags")

        db.clear()
        db.set("type", "firebase")
        db.set("write", write)
        db.set("vms", vms)
        db.set("tags", tags)
        
        // Also keep config
        db.set("config", dbProfile);

    } catch (e) {
        console.error("Firebase sync error:", e);
        throw e;
    }
};
        db.set("tags", tags)
    } catch {
        return -1
    }
}