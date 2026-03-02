const db = require('../../util/profile-db');
const { enqueueProfileSync } = require('../../util/cloud-sync');

module.exports = async (filesPath, tag) => {
    const result = db.push('tags', tag);

    enqueueProfileSync('push', {
        source: 'hosts-add-tag'
    }).catch((err) => {
        console.error('Auto sync push failed after tag add:', err);
    });

    return result;
};

