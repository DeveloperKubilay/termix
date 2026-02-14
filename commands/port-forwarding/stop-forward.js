const manager = require('../../util/port-forwarding/manager');

module.exports = async (filesPath, forwardId) => {
    return manager.stopForward(forwardId);
};
