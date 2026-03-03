const fs = require('fs');
const path = require('path');
const {
    normalizeAiSettings,
    normalizeTerminalSettings
} = require('./profile-defaults');
const { normalizeCloudConfig } = require('./profile-secrets');
const { DATA_ROOT, PROFILES_DIR, ASAR_ROOT } = require('./paths');

const REGISTRY_FILE = path.join(PROFILES_DIR, 'registry.json');
const LEGACY_ACTIVE_DB_FILE = path.join(DATA_ROOT, 'kubitdb.json');
const LEGACY_PROFILES_DIR = path.join(ASAR_ROOT, 'commands', 'profiles', 'profiles');

let isInitialized = false;

function ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function readJson(filePath, fallback = {}) {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (parsed && typeof parsed === 'object') {
            return parsed;
        }
    } catch (_) {}

    return fallback;
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

function normalizeProfileType(type) {
    const normalized = String(type || '').toLowerCase().trim();
    if (normalized === 'firebase' || normalized === 'qmm') {
        return normalized;
    }
    return 'local';
}

function getSyncProvider(type) {
    const normalized = normalizeProfileType(type);
    if (normalized === 'firebase') {
        return {
            key: 'firebase',
            providerName: 'Firebase',
            syncModulePath: './firebase'
        };
    }

    if (normalized === 'qmm') {
        return {
            key: 'qmm',
            providerName: 'QMM',
            syncModulePath: './qmm'
        };
    }

    return null;
}

function profileFilePath(profileId) {
    return path.join(PROFILES_DIR, `${profileId}.json`);
}

function normalizeProfileData(data = {}, fallbackName = 'Default') {
    const type = normalizeProfileType(data.type);
    const normalized = { ...data };

    normalized.name = (data.name || fallbackName || 'Default').toString();
    normalized.type = type;
    normalized.write = type !== 'local' ? Boolean(data.write) : true;
    normalized.config = normalizeCloudConfig(type, data.config);
    normalized.hosts = Array.isArray(data.hosts) ? data.hosts : [];
    normalized.tags = Array.isArray(data.tags) ? data.tags : [];
    normalized.knownHosts = Array.isArray(data.knownHosts) ? data.knownHosts : [];
    normalized.snippets = Array.isArray(data.snippets) ? data.snippets : [];
    normalized.ai = normalizeAiSettings(data.ai);
    normalized.terminalSettings = normalizeTerminalSettings(data.terminalSettings);

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

function generateProfileId(registry, name) {
    const existing = new Set(registry.profiles.map((item) => item.id));
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

    const legacyFiles = fs.readdirSync(LEGACY_PROFILES_DIR).filter((file) => file.endsWith('.json'));
    if (legacyFiles.length === 0) return false;

    let migrated = false;

    for (const file of legacyFiles) {
        const legacyPath = path.join(LEGACY_PROFILES_DIR, file);
        const legacyData = readJson(legacyPath, null);
        if (!legacyData || typeof legacyData !== 'object') continue;

        const legacyName = String(legacyData.name || file.replace('.json', '')).trim();
        if (!legacyName) continue;

        const hasSameName = registry.profiles.some((profile) => {
            return String(profile.name || '').toLowerCase() === legacyName.toLowerCase();
        });
        if (hasSameName) continue;

        const profileId = generateProfileId(registry, legacyName);
        const now = new Date().toISOString();

        const entry = {
            id: profileId,
            name: legacyName,
            type: normalizeProfileType(legacyData.type),
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

function getActiveProfileFilePath(profileId) {
    if (profileId) {
        return profileFilePath(profileId);
    }

    const registry = readRegistry();
    if (!registry.activeProfileId) return null;
    return profileFilePath(registry.activeProfileId);
}

function ensureBaseRegistry() {
    ensureDir(PROFILES_DIR);

    let registry = readRegistry();
    const legacyRootData = readJson(LEGACY_ACTIVE_DB_FILE, {});
    const hasLegacyRootData = Object.keys(legacyRootData).length > 0;
    let changed = false;

    if (registry.profiles.length === 0) {
        const now = new Date().toISOString();
        const profileId = 'default';
        const profileName = String(legacyRootData.name || 'Default');

        const profile = {
            id: profileId,
            name: profileName,
            type: normalizeProfileType(legacyRootData.type),
            createdAt: now,
            updatedAt: now,
            usedAt: now
        };

        const seedData = normalizeProfileData(hasLegacyRootData ? legacyRootData : {}, profileName);
        writeJson(profileFilePath(profileId), seedData);

        registry = {
            activeProfileId: profileId,
            profiles: [profile]
        };

        changed = true;
    }

    if (migrateLegacyProfiles(registry)) {
        changed = true;
    }

    const seen = new Set();
    registry.profiles = registry.profiles.filter((item) => {
        if (!item || typeof item !== 'object') return false;
        if (!item.id) item.id = generateProfileId(registry, item.name || 'profile');
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
    });

    if (!registry.profiles.length) {
        const now = new Date().toISOString();
        registry.profiles.push({
            id: 'default',
            name: 'Default',
            type: 'local',
            createdAt: now,
            updatedAt: now,
            usedAt: now
        });
        registry.activeProfileId = 'default';
        writeJson(profileFilePath('default'), normalizeProfileData({}, 'Default'));
        changed = true;
    }

    if (!registry.activeProfileId || !registry.profiles.find((item) => item.id === registry.activeProfileId)) {
        registry.activeProfileId = registry.profiles[0].id;
        changed = true;
    }

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
        const exists = fs.existsSync(dataPath);

        let sourceData = {};
        if (exists) {
            sourceData = readJson(dataPath, {});
        } else if (hasLegacyRootData && profile.id === registry.activeProfileId) {
            sourceData = legacyRootData;
        }

        const normalized = normalizeProfileData(sourceData, profile.name);
        if (!exists || JSON.stringify(sourceData) !== JSON.stringify(normalized)) {
            writeJson(dataPath, normalized);
            changed = true;
        }

        if (profile.name !== normalized.name || profile.type !== normalized.type) {
            profile.name = normalized.name;
            profile.type = normalized.type;
            changed = true;
        }
    }

    if (changed) {
        writeRegistry(registry);
    }

    return registry;
}

function ensureInitialized() {
    if (!isInitialized) {
        ensureBaseRegistry();
        isInitialized = true;
    }

    const registry = readRegistry();
    const activeProfile = registry.profiles.find((item) => item.id === registry.activeProfileId) || null;
    return { registry, activeProfile };
}

function getProfiles() {
    const { registry } = ensureInitialized();
    let registryChanged = false;
    const profiles = registry.profiles.map((item) => {
        const data = normalizeProfileData(readJson(profileFilePath(item.id), {}), item.name);

        if (item.name !== data.name || item.type !== data.type) {
            item.name = data.name;
            item.type = data.type;
            item.updatedAt = new Date().toISOString();
            registryChanged = true;
        }

        return {
            id: item.id,
            name: data.name || item.name,
            type: data.type,
            write: data.write,
            usedAt: item.usedAt || null
        };
    });

    if (registryChanged) {
        writeRegistry(registry);
    }

    return {
        activeProfileId: registry.activeProfileId,
        profiles
    };
}

async function switchProfile(profileId, options = {}) {
    const { registry, activeProfile } = ensureInitialized();
    const target = registry.profiles.find((item) => item.id === profileId);

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

    registry.activeProfileId = target.id;
    writeRegistry(registry);

    let currentData = normalizeProfileData(readJson(profileFilePath(target.id), {}), target.name);
    writeJson(profileFilePath(target.id), currentData);

    let cloudSync = null;
    const syncProvider = getSyncProvider(currentData.type);
    const pullAllowed = syncProvider && options.pullFromCloud !== false;
    const providerPullEnabled = pullAllowed
        && (syncProvider.key !== 'firebase' || options.pullFromFirebase !== false)
        && (syncProvider.key !== 'qmm' || options.pullFromQmm !== false);

    if (providerPullEnabled) {
        try {
            const syncProviderUtil = require(syncProvider.syncModulePath);
            const result = await syncProviderUtil(false);
            if (result && result.success === false) {
                throw new Error(result.message || `${syncProvider.providerName} pull failed.`);
            }

            currentData = normalizeProfileData(readJson(profileFilePath(target.id), {}), target.name);
            writeJson(profileFilePath(target.id), currentData);
            const details = result && typeof result === 'object' ? { ...result } : {};
            delete details.success;
            cloudSync = {
                success: true,
                provider: syncProvider.key,
                providerName: syncProvider.providerName,
                mode: 'pull',
                ...details
            };
        } catch (err) {
            cloudSync = {
                success: false,
                provider: syncProvider.key,
                providerName: syncProvider.providerName,
                mode: 'pull',
                message: err.message
            };
        }
    }

    const now = new Date().toISOString();
    target.name = currentData.name;
    target.type = currentData.type;
    target.usedAt = now;
    target.updatedAt = now;

    writeRegistry(registry);

    return {
        success: true,
        switched: true,
        profile: {
            id: target.id,
            name: currentData.name,
            type: currentData.type
        },
        cloudSync,
        firebaseSync: cloudSync && cloudSync.provider === 'firebase' ? cloudSync : null
    };
}

async function createProfile(payload = {}) {
    const { registry } = ensureInitialized();
    const name = String(payload.name || '').trim();

    if (!name) {
        throw new Error('Profile name is required.');
    }

    const hasSameName = registry.profiles.some((item) => {
        return String(item.name || '').toLowerCase() === name.toLowerCase();
    });
    if (hasSameName) {
        throw new Error(`Profile '${name}' already exists.`);
    }

    const type = normalizeProfileType(payload.type);
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
        cloudSync: switchResult ? (switchResult.cloudSync || null) : null,
        firebaseSync: switchResult ? (switchResult.firebaseSync || null) : null
    };
}

function persistActiveProfileData() {
    const { registry, activeProfile } = ensureInitialized();
    if (!activeProfile) return null;

    const dataPath = profileFilePath(activeProfile.id);
    const normalized = normalizeProfileData(readJson(dataPath, {}), activeProfile.name);
    writeJson(dataPath, normalized);

    const now = new Date().toISOString();
    activeProfile.name = normalized.name;
    activeProfile.type = normalized.type;
    activeProfile.updatedAt = now;

    writeRegistry(registry);
    return normalized;
}

module.exports = {
    ensureInitialized,
    getProfiles,
    createProfile,
    switchProfile,
    persistActiveProfileData,
    getActiveProfileFilePath,
    paths: {
        profilesDir: PROFILES_DIR,
        registryFile: REGISTRY_FILE,
        get activeDbFile() {
            return getActiveProfileFilePath();
        },
        legacyDbFile: LEGACY_ACTIVE_DB_FILE
    }
};
