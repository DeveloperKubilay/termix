const manager = require('../../util/sftp/manager');

module.exports = async (filesPath, sessionId) => {
    return manager.disconnect(sessionId);
};
