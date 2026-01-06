const kubitdb = require('kubitdb');
const db = new kubitdb();

module.exports = (filesPath, settings) => {
    const currentSettings = db.get('terminalSettings') || {};
    const newSettings = { ...currentSettings, ...settings };
    db.set('terminalSettings', newSettings);
    return newSettings;
};
