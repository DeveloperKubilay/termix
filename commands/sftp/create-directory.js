const manager = require('../../util/sftp/manager');

module.exports = async (filesPath, payload = {}) => {
    return manager.createDirectory(payload);
};
