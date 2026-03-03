const updater = require('../../util/updater');

module.exports = async function (filesPath, payload = {}) {
    const enabled = Boolean(payload && payload.autoUpdateEnabled);
    const state = updater.setAutoUpdateEnabled(enabled);

    return {
        success: true,
        state
    };
};
