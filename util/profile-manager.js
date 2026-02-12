const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const PROFILES_DIR = path.join(ROOT_DIR, 'profiles');
const REGISTRY_FILE = path.join(PROFILES_DIR, 'registry.json');
const ACTIVE_DB_FILE = path.join(ROOT_DIR, 'kubitdb.json');
const LEGACY_PROFILES_DIR = path.join(ROOT_DIR, 'commands', 'profiles', 'profiles');

let isInitialized = false;

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function readJson(filePath, fallback = {}) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (_) {
        return fallback;
    }
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function toSlug(value) {
    return String(value || '')
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'profile';
}

function isFirebaseType(type) {
    return String(type || '').toLowerCase() === 'firebase';
}

function profileFilePath(profileId) {
    return path.join(PROFILES_DIR, `${profileId}.json`);
}

function normalizeProfileData(data = {}, fallbackName = 'Default') {
    const type = isFirebaseType(data.type) ? 'firebase' : 'local';
    const normalized = { ...data };

    normalized.name = (data.name || fallbackName || 'Default').toString();
    normalized.type = type;
    normalized.write = type === 'firebase' ? Boolean(data.write) : true;
    normalized.config = type === 'firebase' && data.config && typeof data.config === 'object'
        ? data.config
        : {};

    if (!Array.isArray(normalized.hosts)) normalized.hosts = [];
    if (!Array.isArray(normalized.tags)) normalized.tags = [];
    if (!Array.isArray(normalized.knownHosts)) normalized.knownHosts = [];
    if (!normalized.ai || typeof normalized.ai !== 'object') {
        normalized.ai = { method: 'GET', url: '', headers: {} };
    }

    return normalized;
}

function readRegistry() {
    const registry = readJson(REGISTRY_FILE, {});
    if (!Array.isArray(registry.profiles)) registry.profiles = [];
    if (typeof registry.activeProfileId !== 'string') registry.activeProfileId = null;
    return registry;
}

function writeRegistry(registry) {
    writeJson(REGISTRY_FILE, registry);
}

function upsertRootFromProfile(profile) {
    const profileData = normalizeProfileData(readJson(profileFilePath(profile.id), {}), profile.name);
    writeJson(ACTIVE_DB_FILE, profileData);
    return profileData;
}

function saveRootToProfile(registry, profileId, markUsed = false) {
    const profile = registry.profiles.find(item => item.id === profileId);
    if (!profile) return null;

    const currentData = normalizeProfileData(readJson(ACTIVE_DB_FILE, {}), profile.name);
    writeJson(profileFilePath(profile.id), currentData);

    const now = new Date().toISOString();
    profile.name = currentData.name;
    profile.type = currentData.type;
    profile.updatedAt = now;
    if (markUsed) profile.usedAt = now;

    return currentData;
}

function generateProfileId(registry, name) {
    const existing = new Set(registry.profiles.map(item => item.id));
    const base = toSlug(name);
    let next = base;
    let index = 2;
    while (existing.has(next)) {
        next = `${base}-${index}`;
        index += 1;
    }
    return next;
}

function migrateLegacyProfiles(registry) {
    if (!fs.existsSync(LEGACY_PROFILES_DIR)) return false;

    const legacyFiles = fs.readdirSync(LEGACY_PROFILES_DIR).filter(file => file.endsWith('.json'));
    if (legacyFiles.length === 0) return false;

    let migrated = false;

    for (const file of legacyFiles) {
        const legacyPath = path.join(LEGACY_PROFILES_DIR, file);
        const legacyData = readJson(legacyPath, null);
        if (!legacyData || typeof legacyData !== 'object') continue;

        const legacyName = String(legacyData.name || file.replace('.json', '')).trim();
        if (!legacyName) continue;

        const hasSameName = registry.profiles.some(profile => profile.name.toLowerCase() === legacyName.toLowerCase());
        if (hasSameName) continue;

        const profileId = generateProfileId(registry, legacyName);
        const now = new Date().toISOString();

        const entry = {
            id: profileId,
            name: legacyName,
            type: isFirebaseType(legacyData.type) ? 'firebase' : 'local',
            createdAt: legacyData.createdAt || now,
            updatedAt: legacyData.updatedAt || now,
            usedAt: legacyData.usedAt || null
        };

        const profileData = normalizeProfileData({
            ...legacyData,
            name: legacyName,
            type: entry.type
        }, legacyName);

        writeJson(profileFilePath(profileId), profileData);
        registry.profiles.push(entry);
        migrated = true;
    }

    return migrated;
}

function ensureBaseRegistry() {
    ensureDir(PROFILES_DIR);

    let registry = readRegistry();
    const rootData = readJson(ACTIVE_DB_FILE, {});
    const hasAnyData = Object.keys(rootData).length > 0;
    let changed = false;

    if (registry.profiles.length === 0) {
        const now = new Date().toISOString();
        const profileId = 'default';
        const profileName = (rootData.name || 'Default').toString();

        const profile = {
            id: profileId,
            name: profileName,
            type: isFirebaseType(rootData.type) ? 'firebase' : 'local',
            createdAt: now,
            updatedAt: now,
            usedAt: now
        };

        const seedData = normalizeProfileData(hasAnyData ? rootData : {}, profileName);

        writeJson(profileFilePath(profileId), seedData);
        writeJson(ACTIVE_DB_FILE, seedData);

        registry = {
            activeProfileId: profileId,
            profiles: [profile]
        };

        writeRegistry(registry);
        changed = true;
    }

    const legacyMigrated = migrateLegacyProfiles(registry);
    if (legacyMigrated) changed = true;

    const seen = new Set();
    registry.profiles = registry.profiles.filter(item => {
        if (!item || typeof item !== 'object') return false;
        if (!item.id) item.id = generateProfileId({ profiles: registry.profiles }, item.name || 'profile');
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
    });

    for (const profile of registry.profiles) {
        if (!profile.name) {
            profile.name = profile.id;
            changed = true;
        }
        if (!profile.type) {
            profile.type = 'local';
            changed = true;
        }

        const dataPath = profileFilePath(profile.id);
        if (!fs.existsSync(dataPath)) {
            const seedData = normalizeProfileData(rootData, profile.name);
            writeJson(dataPath, seedData);
            changed = true;
        }
    }

    if (!registry.activeProfileId || !registry.profiles.find(item => item.id === registry.activeProfileId)) {
        registry.activeProfileId = registry.profiles[0].id;
        changed = true;
    }

    const active = registry.profiles.find(item => item.id === registry.activeProfileId);
    const activeProfilePath = profileFilePath(active.id);

    if (fs.existsSync(ACTIVE_DB_FILE)) {
        const rootStat = fs.statSync(ACTIVE_DB_FILE);
        const profileStat = fs.statSync(activeProfilePath);

        if (rootStat.mtimeMs >= profileStat.mtimeMs) {
            const normalizedRoot = normalizeProfileData(readJson(ACTIVE_DB_FILE, {}), active.name);
            writeJson(activeProfilePath, normalizedRoot);
            active.name = normalizedRoot.name;
            active.type = normalizedRoot.type;
            changed = true;
        } else {
            upsertRootFromProfile(active);
        }
    } else {
        upsertRootFromProfile(active);
    }

    if (changed) writeRegistry(registry);
    return registry;
}

function ensureInitialized() {
    if (!isInitialized) {
        ensureBaseRegistry();
        isInitialized = true;
    }

    const registry = readRegistry();
    const activeProfile = registry.profiles.find(item => item.id === registry.activeProfileId) || null;
    return { registry, activeProfile };
}

function getProfiles() {
    const { registry } = ensureInitialized();
    const profiles = registry.profiles.map(item => {
        const data = normalizeProfileData(readJson(profileFilePath(item.id), {}), item.name);
        return {
            id: item.id,
            name: data.name || item.name,
            type: data.type,
            write: data.write,
            usedAt: item.usedAt || null
        };
    });

    return {
        activeProfileId: registry.activeProfileId,
        profiles
    };
}

async function switchProfile(profileId, options = {}) {
    const { registry, activeProfile } = ensureInitialized();
    const target = registry.profiles.find(item => item.id === profileId);

    if (!target) {
        throw new Error('Profile not found.');
    }

    if (activeProfile && activeProfile.id === target.id) {
        return {
            success: true,
            switched: false,
            profile: {
                id: target.id,
                name: target.name,
                type: target.type
            }
        };
    }

    if (activeProfile) {
        saveRootToProfile(registry, activeProfile.id, false);
    }

    registry.activeProfileId = target.id;
    let currentData = upsertRootFromProfile(target);

    let firebaseSync = null;
    if (currentData.type === 'firebase' && options.pullFromFirebase !== false) {
        try {
            const syncFirebase = require('./firebase');
            const result = await syncFirebase(false);
            if (result && result.success === false) {
                throw new Error(result.message || 'Firebase pull failed.');
            }
            currentData = normalizeProfileData(readJson(ACTIVE_DB_FILE, {}), target.name);
            firebaseSync = { success: true };
        } catch (err) {
            firebaseSync = { success: false, message: err.message };
        }
    }

    writeJson(ACTIVE_DB_FILE, currentData);
    saveRootToProfile(registry, target.id, true);
    writeRegistry(registry);

    return {
        success: true,
        switched: true,
        profile: {
            id: target.id,
            name: currentData.name,
            type: currentData.type
        },
        firebaseSync
    };
}

async function createProfile(payload = {}) {
    const { registry } = ensureInitialized();
    const name = String(payload.name || '').trim();

    if (!name) {
        throw new Error('Profile name is required.');
    }

    const hasSameName = registry.profiles.some(item => item.name.toLowerCase() === name.toLowerCase());
    if (hasSameName) {
        throw new Error(`Profile '${name}' already exists.`);
    }

    const type = isFirebaseType(payload.type) ? 'firebase' : 'local';
    const profileId = generateProfileId(registry, name);
    const now = new Date().toISOString();

    const entry = {
        id: profileId,
        name,
        type,
        createdAt: now,
        updatedAt: now,
        usedAt: null
    };

    const data = normalizeProfileData({
        name,
        type,
        write: payload.write,
        config: payload.config
    }, name);

    writeJson(profileFilePath(profileId), data);
    registry.profiles.push(entry);
    writeRegistry(registry);

    let switchResult = null;
    const activate = payload.activate !== false;
    if (activate) {
        switchResult = await switchProfile(profileId);
    }

    return {
        success: true,
        message: activate
            ? `Profile '${name}' created and activated.`
            : `Profile '${name}' created successfully.`,
        profile: {
            id: profileId,
            name,
            type
        },
        switched: Boolean(switchResult && switchResult.switched),
        firebaseSync: switchResult ? (switchResult.firebaseSync || null) : null
    };
}

function persistActiveProfileData() {
    const { registry, activeProfile } = ensureInitialized();
    if (!activeProfile) return null;
    const data = saveRootToProfile(registry, activeProfile.id, false);
    writeRegistry(registry);
    return data;
}

module.exports = {
    ensureInitialized,
    getProfiles,
    createProfile,
    switchProfile,
    persistActiveProfileData,
    paths: {
        profilesDir: PROFILES_DIR,
        registryFile: REGISTRY_FILE,
        activeDbFile: ACTIVE_DB_FILE
    }
};
