const db = require('../../util/profile-db');
const { enqueueProfileSync } = require('../../util/cloud-sync');

module.exports = async (filesPath, tagToDelete) => {
    // 1. Remove from global 'tags' list
    let tags = db.get('tags') || [];
    tags = tags.filter(t => t !== tagToDelete);
    db.set('tags', tags);

    // 2. Remove tag from all hosts
    // 'hosts' is the key used in set-data.js and get-data.js
    let hosts = db.get('hosts') || []; 
    
    // We update the hosts array
    let updatedHosts = hosts.map(host => {
        // Ensure host.tags exists and is an array
        if (host.tags && Array.isArray(host.tags)) {
            // Filter out the tag to delete
            host.tags = host.tags.filter(t => t !== tagToDelete);
        }
        return host;
    });
    
    // Save back to DB
    db.set('hosts', updatedHosts);

    enqueueProfileSync('push', {
        source: 'hosts-delete-tag'
    }).catch((err) => {
        console.error('Auto sync push failed after tag delete:', err);
    });

    return tags;
};

