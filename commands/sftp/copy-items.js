const manager = require('../../util/sftp/manager');

module.exports = async (filesPath, payload = {}, event) => {
    return manager.copyItems(payload, (progress) => {
        if (event && event.sender && payload && payload.operationId) {
            event.sender.send('sftp:copy-progress', progress);
        }
    });
};
