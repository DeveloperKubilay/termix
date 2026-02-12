const profileManager = require('../../util/profile-manager');

module.exports = async function () {
    return profileManager.getProfiles();
};
