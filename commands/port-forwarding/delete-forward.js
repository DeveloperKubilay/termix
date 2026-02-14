const kubitdb = require('kubitdb');
const manager = require('../../util/port-forwarding/manager');

const db = new kubitdb();

module.exports = async (filesPath, forwardId) => {
    try {
        const normalizedId = String(forwardId || '').trim();
        if (!normalizedId) {
            return { success: false, message: 'Forward id is required.' };
        }

        await manager.stopForward(normalizedId);

        const forwards = Array.isArray(db.get('portForwards')) ? db.get('portForwards') : [];
        const next = forwards.filter((item) => String(item.id) !== normalizedId);

        db.set('portForwards', next);
        manager.clearForwardState(normalizedId);

        return { success: true };
    } catch (err) {
        return {
            success: false,
            message: err && err.message ? err.message : String(err)
        };
    }
};
