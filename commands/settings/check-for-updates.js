const updater = require('../../util/updater');

module.exports = async function () {
    return updater.checkForUpdates({ manual: true });
};
