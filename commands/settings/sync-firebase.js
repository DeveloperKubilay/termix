const firebase = require('../../util/firebase');
const qmm = require('../../util/qmm');
const db = require('../../util/profile-db');
const profileManager = require('../../util/profile-manager');

module.exports = async function (filesPath, action) {
    const type = db.get("type");
    const providers = {
        firebase: {
            label: 'Firebase',
            sync: firebase
        },
        qmm: {
            label: 'QMM',
            sync: qmm
        }
    };

    const provider = providers[type];

    if (!provider) {
        throw new Error("Only available for Firebase or QMM users.");
    }

    if (action !== 'push' && action !== 'pull') {
        throw new Error("Invalid action. Use 'push' or 'pull'.");
    }
    
    try {
        const isPush = action === 'push';
        await provider.sync(isPush);

        const actionText = isPush ? 'pushed to' : 'fetched from';

        profileManager.persistActiveProfileData();
        return {
            success: true,
            provider: type,
            message: `Data ${actionText} ${provider.label} successfully.`
        };
    } catch (err) {
        console.error(err);
        return {
            success: false,
            provider: type,
            message: `Sync failed (${provider.label}): ${err.message}`
        };
    }
};

