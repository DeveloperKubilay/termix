const { initializeApp, getApps } = require('firebase/app');
const {
    getFirestore,
    collection,
    getDocs,
    addDoc,
    deleteDoc,
    doc
} = require('firebase/firestore');
const kubitdb = require('kubitdb');

const db = new kubitdb();

function getProfileFirebaseConfig() {
    const config = db.get('config') || {};
    const {
        collectionName = 'hosts',
        tagsCollectionName = 'tags',
        ...firebaseConfig
    } = config;

    return {
        firebaseConfig,
        collectionName,
        tagsCollectionName
    };
}

function getFirebaseApp(firebaseConfig) {
    if (!firebaseConfig || typeof firebaseConfig !== 'object' || Object.keys(firebaseConfig).length === 0) {
        throw new Error('Firebase configuration is missing.');
    }

    const profileName = String(db.get('name') || 'profile').replace(/[^a-zA-Z0-9-_]/g, '-');
    const appName = `termix-${profileName}`;
    const existing = getApps().find(app => app.name === appName);
    return existing || initializeApp(firebaseConfig, appName);
}

async function readCollection(firestoreDb, collectionName) {
    const snapshot = await getDocs(collection(firestoreDb, collectionName));
    return snapshot.docs.map(item => item.data());
}

async function clearCollection(firestoreDb, collectionName) {
    const snapshot = await getDocs(collection(firestoreDb, collectionName));
    for (const item of snapshot.docs) {
        await deleteDoc(doc(firestoreDb, collectionName, item.id));
    }
}

async function writeCollection(firestoreDb, collectionName, data = []) {
    for (const item of data) {
        await addDoc(collection(firestoreDb, collectionName), item);
    }
}

function normalizeTagDocuments(items = []) {
    return items
        .map(item => {
            if (typeof item === 'string') return item;
            if (item && typeof item.value === 'string') return item.value;
            if (item && typeof item.tag === 'string') return item.tag;

            if (item && typeof item === 'object') {
                const values = Object.values(item).filter(value => typeof value === 'string');
                if (values.length === 1) return values[0];
            }

            return null;
        })
        .filter(Boolean);
}

module.exports = async function (upload) {
    const type = db.get('type');
    if (type !== 'firebase') {
        throw new Error('Active profile is not configured for Firebase.');
    }

    const { firebaseConfig, collectionName, tagsCollectionName } = getProfileFirebaseConfig();
    const app = getFirebaseApp(firebaseConfig);
    const firestoreDb = getFirestore(app);

    if (upload) {
        const hosts = db.get('hosts') || db.get('vms') || [];
        const tags = db.get('tags') || [];

        await clearCollection(firestoreDb, collectionName);
        await clearCollection(firestoreDb, tagsCollectionName);

        await writeCollection(firestoreDb, collectionName, hosts);
        await writeCollection(
            firestoreDb,
            tagsCollectionName,
            tags.map(tag => ({ value: tag }))
        );

        return { success: true, mode: 'push' };
    }

    const hosts = await readCollection(firestoreDb, collectionName);
    const tagDocs = await readCollection(firestoreDb, tagsCollectionName);
    const tags = normalizeTagDocuments(tagDocs);

    db.set('hosts', hosts);
    db.set('tags', tags);

    return {
        success: true,
        mode: 'pull',
        hostsCount: hosts.length,
        tagsCount: tags.length
    };
};
