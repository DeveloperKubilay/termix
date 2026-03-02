const db = require('../../util/profile-db');
const { enqueueProfileSync } = require('../../util/cloud-sync');

module.exports = async function (filesPath, action) {
    const type = String(db.get('type') || '').toLowerCase();

    if (type !== 'firebase' && type !== 'qmm') {
        throw new Error("Only available for Firebase or QMM users.");
    }

    if (action !== 'push' && action !== 'pull') {
        throw new Error("Invalid action. Use 'push' or 'pull'.");
    }
    
    try {
        const result = await enqueueProfileSync(action, {
            persistBefore: true,
            persistAfter: true,
            source: 'settings-manual-sync'
        });

        return {
            success: true,
            provider: result.provider || type,
            message: result.message
        };
    } catch (err) {
        console.error(err);
        return {
            success: false,
            provider: type,
            message: `Sync failed (${type === 'qmm' ? 'QMM' : 'Firebase'}): ${err.message}`
        };
    }
};

