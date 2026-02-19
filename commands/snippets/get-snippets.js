const kubitdb = require('kubitdb');
const db = new kubitdb();

module.exports = async () => {
    const raw = db.get('snippets');
    const snippets = Array.isArray(raw) ? raw : [];

    return snippets
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
            id: item.id,
            name: String(item.name || '').trim(),
            command: String(item.command || '').trim(),
            source: item.source === 'url' ? 'url' : 'manual',
            url: String(item.url || '').trim(),
            createdAt: Number(item.createdAt || 0) || 0,
            updatedAt: Number(item.updatedAt || 0) || 0
        }))
        .filter((item) => item.id != null && item.name && item.command)
        .sort((a, b) => {
            const aTime = Number(a.updatedAt || a.createdAt || 0);
            const bTime = Number(b.updatedAt || b.createdAt || 0);
            return bTime - aTime;
        });
};
