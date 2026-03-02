const db = require('./profile-db');
const profileManager = require('./profile-manager');

const VALID_ACTIONS = new Set(['push', 'pull']);
const DEFAULT_SYNC_TIMEOUT_MS = 20000;

let syncQueue = Promise.resolve();

function withTimeout(promise, timeoutMs, actionName) {
    let timeoutId = null;

    const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error(`${actionName} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
    });
}

function getSyncProvider(type) {
    const normalizedType = String(type || '').toLowerCase().trim();

    if (normalizedType === 'firebase') {
        return {
            key: 'firebase',
            label: 'Firebase',
            sync: require('./firebase')
        };
    }

    if (normalizedType === 'qmm') {
        return {
            key: 'qmm',
            label: 'QMM',
            sync: require('./qmm')
        };
    }

    return null;
}

function normalizeAction(action) {
    const normalized = String(action || '').toLowerCase().trim();
    if (!VALID_ACTIONS.has(normalized)) {
        throw new Error("Invalid action. Use 'push' or 'pull'.");
    }
    return normalized;
}

function resolveTimeoutMs(options = {}) {
    if (options.timeoutMs === 0) {
        return 0;
    }

    const explicitTimeout = Number(options.timeoutMs);
    if (Number.isFinite(explicitTimeout) && explicitTimeout > 0) {
        return Math.floor(explicitTimeout);
    }

    return DEFAULT_SYNC_TIMEOUT_MS;
}

async function syncActiveProfile(action, options = {}) {
    const normalizedAction = normalizeAction(action);
    const provider = getSyncProvider(db.get('type'));

    if (!provider) {
        return {
            success: true,
            skipped: true,
            provider: 'local',
            mode: normalizedAction,
            message: 'Active profile is local. Cloud sync skipped.'
        };
    }

    if (options.persistBefore !== false) {
        profileManager.persistActiveProfileData();
    }

    const isPush = normalizedAction === 'push';
    const timeoutMs = resolveTimeoutMs(options);
    const syncResult = timeoutMs > 0
        ? await withTimeout(provider.sync(isPush), timeoutMs, `${provider.label} ${normalizedAction}`)
        : await provider.sync(isPush);
    if (syncResult && syncResult.success === false) {
        throw new Error(syncResult.message || `${provider.label} ${normalizedAction} failed.`);
    }

    if (options.persistAfter !== false) {
        profileManager.persistActiveProfileData();
    }

    return {
        success: true,
        skipped: false,
        provider: provider.key,
        mode: normalizedAction,
        message: `Data ${isPush ? 'pushed to' : 'fetched from'} ${provider.label} successfully.`,
        result: syncResult && typeof syncResult === 'object' ? syncResult : null
    };
}

function enqueueProfileSync(action, options = {}) {
    const task = syncQueue.then(() => syncActiveProfile(action, options));
    syncQueue = task.catch(() => {});
    return task;
}

module.exports = {
    syncActiveProfile,
    enqueueProfileSync
};
