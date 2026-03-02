const db = require('../../util/profile-db');

module.exports = (filesPath, settings) => {
    const currentSettings = db.get('terminalSettings') || {};
    const newSettings = { ...currentSettings, ...settings };
    db.set('terminalSettings', newSettings);
    return newSettings;
};

