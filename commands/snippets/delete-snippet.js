const db = require('../../util/profile-db');

module.exports = async (filesPath, snippetId) => {
    const id = String(snippetId || '').trim();
    if (!id) {
        return { success: false, message: 'Snippet id is required.' };
    }

    const raw = db.get('snippets');
    const snippets = Array.isArray(raw) ? raw : [];
    const nextSnippets = snippets.filter((item) => String(item && item.id) !== id);

    if (nextSnippets.length === snippets.length) {
        return { success: false, message: 'Snippet not found.' };
    }

    db.set('snippets', nextSnippets);
    return { success: true };
};

