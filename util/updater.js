const { app, BrowserWindow } = require('electron');
const db = require('./profile-db');

let autoUpdater = null;
try {
    ({ autoUpdater } = require('electron-updater'));
} catch (_) {
    autoUpdater = null;
}

let initialized = false;
let checkPromise = null;
let downloadPromise = null;
let installScheduled = false;
let installingUpdate = false;
let lastCheckContext = {
    manual: false,
    source: 'startup'
};
let autoInstallAfterDownload = false;

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

function pickVersion(...values) {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) {
            return value.trim();
        }
    }
    return null;
}

function resolveVersion(info = {}) {
    if (!info || typeof info !== 'object') {
        return null;
    }

    return pickVersion(
        info.version,
        info.tag,
        info.releaseName,
        info.releaseInfo && info.releaseInfo.version,
        info.releaseInfo && info.releaseInfo.tag,
        info.releaseInfo && info.releaseInfo.releaseName
    );
}

function syncAvailableVersion(info = {}) {
    const version = resolveVersion(info);
    if (version) {
        state.availableVersion = version;
    }
    return version;
}

function resetTransferStats() {
    state.bytesPerSecond = 0;
    state.transferred = 0;
    state.total = 0;
}

async function installAndRestart({ autoTriggered = false } = {}) {
    if (installScheduled || installingUpdate) {
        return false;
    }

    const version = state.downloadedVersion || state.availableVersion || null;
    installScheduled = true;
    state.status = 'installing';
    state.message = autoTriggered
        ? (version
            ? `Version ${version} downloaded. Restarting to install...`
            : 'Update downloaded. Restarting to install...')
        : (version
            ? `Installing version ${version} and restarting...`
            : 'Installing update and restarting...');
    emitState();

    try {
        const mcpServer = require('./mcp/server');
        await mcpServer.stop();
    } catch (_) {}
    try {
        const sftpManager = require('./sftp/manager');
        await sftpManager.disconnectAll();
    } catch (_) {}
    try {
        const sshExec = require('./connections/ssh-exec');
        sshExec.closeAll();
    } catch (_) {}

    try {
        autoUpdater.quitAndInstall(false, true);
    } catch (err) {
        installScheduled = false;
        markError(err);
    }

    return true;
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
    autoInstallAfterDownload = false;
    installScheduled = false;
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
        resetTransferStats();
        emitState();
    });

    autoUpdater.on('update-available', (info = {}) => {
        const version = syncAvailableVersion(info);
        state.downloadedVersion = null;
        state.status = 'available';
        state.message = version
            ? `Version ${version} is available.`
            : 'A new update is available.';
        state.progress = 0;
        resetTransferStats();
        autoInstallAfterDownload = state.autoUpdateEnabled
            && !lastCheckContext.manual
            && lastCheckContext.source === 'startup';
        emitState();
        downloadUpdate().catch(markError);
    });

    autoUpdater.on('update-not-available', () => {
        state.availableVersion = null;
        state.downloadedVersion = null;
        state.status = 'up-to-date';
        state.message = 'You are using the latest version.';
        state.progress = 0;
        resetTransferStats();
        autoInstallAfterDownload = false;
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
        const version = syncAvailableVersion(info) || state.availableVersion || null;
        state.downloadedVersion = version;
        state.progress = 100;
        resetTransferStats();

        if (autoInstallAfterDownload) {
            installAndRestart({ autoTriggered: true });
            return;
        }

        state.status = 'downloaded';
        state.message = version
            ? `Version ${version} is ready to install.`
            : 'Update downloaded and ready to install.';
        emitState();
    });

    autoUpdater.on('error', (err) => {
        markError(err);
    });
}

function getState() {
    return { ...state };
}

async function checkForUpdates({ manual = false, source = manual ? 'manual' : 'background' } = {}) {
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
            lastCheckContext = {
                manual: Boolean(manual),
                source: source || (manual ? 'manual' : 'background')
            };
            autoInstallAfterDownload = false;
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
            const result = await autoUpdater.checkForUpdates();
            const hasUpdate = result && result.isUpdateAvailable === true;

            if (hasUpdate) {
                const version = syncAvailableVersion(result.updateInfo);
                if (state.status === 'checking' || state.status === 'idle') {
                    state.status = 'available';
                    state.message = version
                        ? `Version ${version} is available.`
                        : 'A new update is available.';
                    emitState();
                }
            } else if (result && result.isUpdateAvailable === false && (state.status === 'checking' || state.status === 'idle')) {
                state.availableVersion = null;
                state.downloadedVersion = null;
                state.status = 'up-to-date';
                state.message = 'You are using the latest version.';
                emitState();
            }

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

    if (state.status === 'installing' || installScheduled || installingUpdate) {
        return {
            success: true,
            message: 'Update install is already in progress.',
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

    if (state.status === 'installing' || installScheduled || installingUpdate) {
        return {
            success: true,
            message: 'Update install is already in progress.',
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

    installAndRestart({ autoTriggered: false });

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
    autoUpdater.autoInstallOnAppQuit = false;

    bindUpdaterEvents();
    app.on('before-quit-for-update', () => {
        installingUpdate = true;
    });
    emitState();

    if (state.autoUpdateEnabled) {
        // Automatic update checks run once on startup; there is no polling loop.
        checkForUpdates({ manual: false, source: 'startup' }).catch((err) => {
            console.error('Initial update check failed:', err);
        });
    }

    return getState();
}

module.exports = {
    init,
    getState,
    isInstallingUpdate: () => installingUpdate || installScheduled,
    setAutoUpdateEnabled,
    checkForUpdates,
    downloadUpdate,
    installUpdate
};
