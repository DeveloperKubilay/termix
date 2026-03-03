const db = require('../../util/profile-db');
const { normalizeUpdateSettings } = require('../../util/profile-defaults');
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

    return { success: true };
};

