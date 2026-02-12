const profileManager = require('../../util/profile-manager');

module.exports = async function (filesPath, data) {
    return profileManager.createProfile({
        ...data,
        activate: data && typeof data.activate !== 'undefined' ? data.activate : true
    });
};
