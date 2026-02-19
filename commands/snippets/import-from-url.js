const kubitdb = require('kubitdb');
const db = new kubitdb();

function normalizeText(value) {
    return String(value == null ? '' : value).trim();
}

function createId() {
    return `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
}

function normalizeSnippetItem(item) {
    if (!item || typeof item !== 'object') return null;

    const name = normalizeText(
        item.name ||
        item.title ||
        item.label ||
        item.commandName ||
        item.key
    );

    const command = normalizeText(
        item.command ||
        item.cmd ||
        item.value ||
        item.script ||
        item.content ||
        item.text
    );

    if (!name || !command) return null;
    return { name, command };
}

function extractSnippetItems(parsed) {
    if (Array.isArray(parsed)) {
        return parsed;
    }

    if (!parsed || typeof parsed !== 'object') {
        return [];
    }

    if (Array.isArray(parsed.snippets)) {
        return parsed.snippets;
    }

    if (Array.isArray(parsed.items)) {
        return parsed.items;
    }

    if (Array.isArray(parsed.data)) {
        return parsed.data;
    }

    if (parsed.snippet && typeof parsed.snippet === 'object') {
        return [parsed.snippet];
    }

    if (parsed.commands && typeof parsed.commands === 'object' && !Array.isArray(parsed.commands)) {
        return Object.entries(parsed.commands).map(([name, command]) => ({ name, command }));
    }

    const entries = Object.entries(parsed);
    if (entries.length && entries.every(([, value]) => typeof value === 'string')) {
        return entries.map(([name, command]) => ({ name, command }));
    }

    return [];
}

function dedupe(items) {
    const seen = new Set();
    const output = [];

    for (const item of items) {
        const key = `${item.name.toLowerCase()}::${item.command}`;
        if (seen.has(key)) continue;
        seen.add(key);
        output.push(item);
    }

    return output;
}

async function fetchJson(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                Accept: 'application/json,text/plain,*/*'
            }
        });

        if (!response.ok) {
            throw new Error(`Request failed with status ${response.status}.`);
        }

        const text = await response.text();
        if (!text.trim()) {
            throw new Error('URL returned empty content.');
        }

        try {
            return JSON.parse(text);
        } catch (_) {
            throw new Error('URL did not return valid JSON.');
        }
    } finally {
        clearTimeout(timeout);
    }
}

module.exports = async (filesPath, payload = {}) => {
    try {
        const url = normalizeText(payload.url);
        if (!url) {
            return { success: false, message: 'URL is required.' };
        }

        let parsedUrl;
        try {
            parsedUrl = new URL(url);
        } catch (_) {
            return { success: false, message: 'Please enter a valid URL.' };
        }

        if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
            return { success: false, message: 'URL must start with http:// or https://.' };
        }

        const parsed = await fetchJson(parsedUrl.toString());
        const normalized = dedupe(
            extractSnippetItems(parsed)
                .map(normalizeSnippetItem)
                .filter(Boolean)
        );

        if (!normalized.length) {
            return {
                success: false,
                message: 'No valid snippets found. Expected name + command fields.'
            };
        }

        const raw = db.get('snippets');
        const snippets = Array.isArray(raw) ? raw : [];

        const existingKeys = new Set(
            snippets.map((item) => {
                const name = normalizeText(item && item.name).toLowerCase();
                const command = normalizeText(item && item.command);
                return `${name}::${command}`;
            })
        );

        let importedCount = 0;
        let skippedCount = 0;

        for (const item of normalized) {
            const dedupeKey = `${item.name.toLowerCase()}::${item.command}`;

            if (existingKeys.has(dedupeKey)) {
                skippedCount += 1;
                continue;
            }

            const now = Date.now();
            snippets.push({
                id: createId(),
                name: item.name,
                command: item.command,
                source: 'url',
                url: parsedUrl.toString(),
                createdAt: now,
                updatedAt: now
            });

            existingKeys.add(dedupeKey);
            importedCount += 1;
        }

        if (importedCount === 0) {
            return {
                success: false,
                message: 'All snippets from this URL already exist.',
                importedCount,
                skippedCount
            };
        }

        db.set('snippets', snippets);

        return {
            success: true,
            importedCount,
            skippedCount
        };
    } catch (err) {
        if (err && err.name === 'AbortError') {
            return { success: false, message: 'Request timed out while fetching URL.' };
        }

        return {
            success: false,
            message: err && err.message ? err.message : String(err)
        };
    }
};
