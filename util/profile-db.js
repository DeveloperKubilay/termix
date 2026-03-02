const fs = require('fs');
const path = require('path');
const profileManager = require('./profile-manager');

function readJson(filePath, fallback = {}) {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
        }
    } catch (_) {}

    return { ...fallback };
}

function writeJson(filePath, data) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function getActiveProfilePath() {
    const { activeProfile } = profileManager.ensureInitialized();
    if (!activeProfile || !activeProfile.id) {
        throw new Error('No active profile found.');
    }

    const filePath = path.join(profileManager.paths.profilesDir, `${activeProfile.id}.json`);

    if (!fs.existsSync(filePath)) {
        writeJson(filePath, {});
    }

    return filePath;
}

function readStore() {
    const filePath = getActiveProfilePath();
    const data = readJson(filePath, {});
    return { filePath, data };
}

function get(key) {
    if (!key) return undefined;
    const { data } = readStore();
    return data[key];
}

function set(key, value) {
    if (!key || typeof value === 'undefined') return undefined;

    const { filePath, data } = readStore();
    data[key] = value;
    writeJson(filePath, data);

    return value;
}

function has(key) {
    if (!key) return false;
    const { data } = readStore();
    return Object.prototype.hasOwnProperty.call(data, key);
}

function push(key, value) {
    if (!key || typeof value === 'undefined') return undefined;

    const { filePath, data } = readStore();
    const list = Array.isArray(data[key]) ? data[key] : [];
    list.push(value);
    data[key] = list;
    writeJson(filePath, data);

    return list.length;
}

function getAll() {
    return readStore().data;
}

function replaceAll(nextData = {}) {
    const filePath = getActiveProfilePath();
    const normalized = nextData && typeof nextData === 'object' && !Array.isArray(nextData)
        ? nextData
        : {};
    writeJson(filePath, normalized);
    return normalized;
}

function update(mutator) {
    const { filePath, data } = readStore();
    const next = typeof mutator === 'function' ? mutator({ ...data }) : data;
    const normalized = next && typeof next === 'object' && !Array.isArray(next) ? next : data;
    writeJson(filePath, normalized);
    return normalized;
}

module.exports = {
    get,
    set,
    has,
    push,
    getAll,
    replaceAll,
    update,
    getActiveProfilePath
};
