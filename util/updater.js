const { app, BrowserWindow } = require('electron');
const db = require('./profile-db');

let autoUpdater = null;
try {
    ({ autoUpdater } = require('electron-updater'));
} catch (_) {
    autoUpdater = null;
}

const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let initialized = false;
let checkPromise = null;
let downloadPromise = null;
let autoCheckTimer = null;

const state = {
    initialized: false,
    supported: false,
    autoUpdateEnabled: true,
    currentVersion: app.getVersion(),
    status: 'idle',
    message: '',
    availableVersion: null,
    downloadedVersion: null,
    progress: 0,
    bytesPerSecond: 0,
    transferred: 0,
    total: 0,
    lastCheckedAt: null,
    lastError: null
};

function roundPercent(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(100, Math.round(parsed * 10) / 10));
}

function normalizeUpdateSettings(value) {
    const normalized = {
        autoUpdateEnabled: true,
        lastCheckedAt: null
    };

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return normalized;
    }

    if (typeof value.autoUpdateEnabled === 'boolean') {
        normalized.autoUpdateEnabled = value.autoUpdateEnabled;
    }

    if (typeof value.lastCheckedAt === 'string' && value.lastCheckedAt.trim()) {
        normalized.lastCheckedAt = value.lastCheckedAt;
    }

    return normalized;
}

function readUpdateSettings() {
    const normalized = normalizeUpdateSettings(db.get('updateSettings'));
    db.set('updateSettings', normalized);
    return normalized;
}

function writeUpdateSettings(next) {
    const normalized = normalizeUpdateSettings(next);
    db.set('updateSettings', normalized);
    return normalized;
}

function emitState() {
    const payload = getState();
    const windows = BrowserWindow.getAllWindows();
    windows.forEach((win) => {
        if (!win.isDestroyed()) {
            win.webContents.send('updater:status', payload);
        }
    });
}

function markError(err) {
    const message = err && err.message ? err.message : String(err || 'Unknown update error');
    state.status = 'error';
    state.message = `Update failed: ${message}`;
    state.lastError = message;
    emitState();
}

function bindUpdaterEvents() {
    autoUpdater.on('checking-for-update', () => {
        state.status = 'checking';
        state.message = 'Checking for updates...';
        state.progress = 0;
        state.lastError = null;
        emitState();
    });

    autoUpdater.on('update-available', (info = {}) => {
        const version = info.version || null;
        state.availableVersion = version;
        state.downloadedVersion = null;
        state.status = 'available';
        state.message = version
            ? `Version ${version} is available.`
            : 'A new update is available.';
        state.progress = 0;
        emitState();
        downloadUpdate().catch(markError);
    });

    autoUpdater.on('update-not-available', () => {
        state.availableVersion = null;
        state.downloadedVersion = null;
        state.status = 'up-to-date';
        state.message = 'You are using the latest version.';
        state.progress = 0;
        emitState();
    });

    autoUpdater.on('download-progress', (progress = {}) => {
        state.status = 'downloading';
        state.message = 'Downloading update...';
        state.progress = roundPercent(progress.percent);
        state.bytesPerSecond = Number(progress.bytesPerSecond || 0);
        state.transferred = Number(progress.transferred || 0);
        state.total = Number(progress.total || 0);
        emitState();
    });

    autoUpdater.on('update-downloaded', (info = {}) => {
        const version = info.version || state.availableVersion || null;
        state.downloadedVersion = version;
        state.status = 'downloaded';
        state.message = version
            ? `Version ${version} is ready to install.`
            : 'Update downloaded and ready to install.';
        state.progress = 100;
        emitState();
    });

    autoUpdater.on('error', (err) => {
        markError(err);
    });
}

function scheduleAutoChecks() {
    if (autoCheckTimer) return;
    autoCheckTimer = setInterval(() => {
        if (!state.autoUpdateEnabled) return;
        checkForUpdates({ manual: false }).catch((err) => {
            console.error('Background update check failed:', err);
        });
    }, AUTO_CHECK_INTERVAL_MS);
    if (typeof autoCheckTimer.unref === 'function') {
        autoCheckTimer.unref();
    }
}

function getState() {
    return { ...state };
}

async function checkForUpdates({ manual = false } = {}) {
    if (!initialized) {
        return {
            success: false,
            message: 'Updater is not initialized yet.',
            state: getState()
        };
    }

    if (!state.supported) {
        return {
            success: false,
            message: state.message || 'Updater is not available in this session.',
            state: getState()
        };
    }

    if (checkPromise) {
        return checkPromise;
    }

    checkPromise = (async () => {
        try {
            const lastCheckedAt = new Date().toISOString();
            const settings = readUpdateSettings();
            writeUpdateSettings({
                ...settings,
                lastCheckedAt
            });
            state.lastCheckedAt = lastCheckedAt;
            state.lastError = null;
            if (manual) {
                state.status = 'checking';
                state.message = 'Checking for updates...';
                emitState();
            }
            await autoUpdater.checkForUpdates();
            return {
                success: true,
                message: 'Update check started.',
                state: getState()
            };
        } catch (err) {
            markError(err);
            return {
                success: false,
                message: state.message,
                state: getState()
            };
        } finally {
            checkPromise = null;
        }
    })();

    return checkPromise;
}

async function downloadUpdate() {
    if (!initialized) {
        return {
            success: false,
            message: 'Updater is not initialized yet.',
            state: getState()
        };
    }

    if (!state.supported) {
        return {
            success: false,
            message: state.message || 'Updater is not available in this session.',
            state: getState()
        };
    }

    if (state.status === 'downloaded') {
        return {
            success: true,
            message: 'Update already downloaded.',
            state: getState()
        };
    }

    if (downloadPromise) {
        return downloadPromise;
    }

    downloadPromise = (async () => {
        try {
            state.status = 'downloading';
            state.message = 'Downloading update...';
            state.progress = 0;
            state.lastError = null;
            emitState();

            await autoUpdater.downloadUpdate();

            return {
                success: true,
                message: 'Download started.',
                state: getState()
            };
        } catch (err) {
            markError(err);
            return {
                success: false,
                message: state.message,
                state: getState()
            };
        } finally {
            downloadPromise = null;
        }
    })();

    return downloadPromise;
}

async function installUpdate() {
    if (!initialized) {
        return {
            success: false,
            message: 'Updater is not initialized yet.',
            state: getState()
        };
    }

    if (!state.supported) {
        return {
            success: false,
            message: state.message || 'Updater is not available in this session.',
            state: getState()
        };
    }

    if (state.status !== 'downloaded') {
        return {
            success: false,
            message: 'No downloaded update to install yet.',
            state: getState()
        };
    }

    setImmediate(() => {
        autoUpdater.quitAndInstall(false, true);
    });

    return {
        success: true,
        message: 'Installing update and restarting app...',
        state: getState()
    };
}

function setAutoUpdateEnabled(enabled) {
    const normalized = Boolean(enabled);
    const settings = writeUpdateSettings({
        ...readUpdateSettings(),
        autoUpdateEnabled: normalized
    });

    state.autoUpdateEnabled = settings.autoUpdateEnabled;
    emitState();

    if (state.autoUpdateEnabled && state.supported) {
        checkForUpdates({ manual: false }).catch((err) => {
            console.error('Failed to start automatic update check:', err);
        });
    }

    return getState();
}

function init() {
    if (initialized) {
        emitState();
        return getState();
    }

    initialized = true;
    const settings = readUpdateSettings();
    state.initialized = true;
    state.autoUpdateEnabled = settings.autoUpdateEnabled;
    state.lastCheckedAt = settings.lastCheckedAt;
    state.currentVersion = app.getVersion();

    if (!app.isPackaged) {
        state.supported = false;
        state.status = 'disabled';
        state.message = 'Updates are available only in packaged builds.';
        emitState();
        return getState();
    }

    if (!autoUpdater) {
        state.supported = false;
        state.status = 'disabled';
        state.message = 'electron-updater is not installed.';
        emitState();
        return getState();
    }

    state.supported = true;
    state.status = 'idle';
    state.message = '';

    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    bindUpdaterEvents();
    scheduleAutoChecks();
    emitState();

    if (state.autoUpdateEnabled) {
        checkForUpdates({ manual: false }).catch((err) => {
            console.error('Initial update check failed:', err);
        });
    }

    return getState();
}

module.exports = {
    init,
    getState,
    setAutoUpdateEnabled,
    checkForUpdates,
    downloadUpdate,
    installUpdate
};
