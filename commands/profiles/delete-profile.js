const profileManager = require('../../util/profile-manager');

module.exports = async function (filesPath, profileId) {
    return profileManager.deleteProfile(profileId);
};
