const kubitdb = require('kubitdb');
const db = new kubitdb();

function normalizeText(value) {
    return String(value == null ? '' : value).trim();
}

function createId() {
    return `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

module.exports = async (filesPath, payload = {}) => {
    const name = normalizeText(payload.name);
    const command = normalizeText(payload.command);

    if (!name) {
        return { success: false, message: 'Snippet name is required.' };
    }

    if (!command) {
        return { success: false, message: 'Snippet command is required.' };
    }

    const raw = db.get('snippets');
    const snippets = Array.isArray(raw) ? raw : [];

    const id = normalizeText(payload.id) || createId();
    const index = snippets.findIndex((item) => String(item.id) === id);
    const current = index >= 0 && snippets[index] && typeof snippets[index] === 'object'
        ? snippets[index]
        : null;

    const now = Date.now();
    const nextSnippet = {
        id,
        name,
        command,
        source: payload.source === 'url' ? 'url' : 'manual',
        url: payload.source === 'url' ? normalizeText(payload.url) : '',
        createdAt: current ? Number(current.createdAt || now) : now,
        updatedAt: now
    };

    if (index >= 0) {
        snippets[index] = nextSnippet;
    } else {
        snippets.push(nextSnippet);
    }

    db.set('snippets', snippets);

    return {
        success: true,
        snippet: nextSnippet
    };
};
