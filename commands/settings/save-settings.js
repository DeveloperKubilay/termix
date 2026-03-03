const db = require('../../util/profile-db');
const { normalizeUpdateSettings, normalizeUiTheme } = require('../../util/profile-defaults');
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

    if (typeof settings.uiTheme !== 'undefined') {
        db.set('uiTheme', normalizeUiTheme(settings.uiTheme));
    }

    return { success: true };
};

