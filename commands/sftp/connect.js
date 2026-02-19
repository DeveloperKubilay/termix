const manager = require('../../util/sftp/manager');

module.exports = async (filesPath, hostId) => {
    return manager.connect(hostId);
};
