const manager = require('../../util/port-forwarding/manager');

module.exports = async (filesPath, forwardId) => {
    try {
        const normalizedId = String(forwardId || '').trim();
        if (!normalizedId) {
            return { success: false, message: 'Forward id is required.' };
        }

        return manager.deleteForward(normalizedId);
    } catch (err) {
        return {
            success: false,
            message: err && err.message ? err.message : String(err)
        };
    }
};
