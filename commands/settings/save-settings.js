const db = require('../../util/profile-db');
const {
    normalizeSftpSettings,
    normalizeUpdateSettings,
    normalizeUiTheme
} = require('../../util/profile-defaults');
const updater = require('../../util/updater');

module.exports = async function (filesPath, settings) {
    if (settings.ai) {
        db.set("ai", settings.ai);
    }

    if (settings.updateSettings) {
        const normalized = normalizeUpdateSettings(settings.updateSettings);
        db.set('updateSettings', normalized);
        updater.setAutoUpdateEnabled(normalized.autoUpdateEnabled);
    }

    if (settings.sftpSettings) {
        db.set('sftpSettings', normalizeSftpSettings(settings.sftpSettings));
    }

    if (typeof settings.uiTheme !== 'undefined') {
        db.set('uiTheme', normalizeUiTheme(settings.uiTheme));
    }

    return { success: true };
};

