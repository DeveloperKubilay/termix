// Skip rules for folder copies, so a transfer can leave out the folders nobody
// wants on the wire (node_modules, .git, build output, ...).
const path = require('path');

function escapeRegex(value) {
    return value.replace(/[.+^${}()|[\]\\]/g, '\\$&');
}

// Supports plain names ("node_modules"), simple globs ("*.log") and path
// fragments ("dist/cache"). A pattern without a slash matches any entry with
// that name at any depth.
function compilePattern(pattern) {
    const raw = String(pattern || '').trim().replace(/^\.\//, '').replace(/\/+$/, '');
    if (!raw) return null;

    const hasSlash = raw.includes('/');
    const source = `^${escapeRegex(raw).replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')}$`;

    return {
        raw,
        hasSlash,
        regex: new RegExp(source)
    };
}

function normalizePatterns(patterns) {
    if (!Array.isArray(patterns)) return [];
    return patterns
        .map(pattern => String(pattern || '').trim())
        .filter(Boolean)
        .slice(0, 200);
}

// Returns a matcher, or null when nothing should be skipped. The matcher takes
// a POSIX-style path relative to the copy root plus the entry name.
function createExcludeMatcher(patterns) {
    const compiled = normalizePatterns(patterns)
        .map(compilePattern)
        .filter(Boolean);

    if (!compiled.length) return null;

    const matcher = (relativePath, name) => {
        const relative = String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '');
        const entryName = name || path.posix.basename(relative);

        for (const rule of compiled) {
            if (rule.hasSlash) {
                // Match the fragment itself and anything beneath it.
                if (rule.regex.test(relative)) return true;
                if (relative.startsWith(`${rule.raw}/`)) return true;
            } else if (rule.regex.test(entryName)) {
                return true;
            }
        }

        return false;
    };

    matcher.patterns = compiled.map(rule => rule.raw);
    return matcher;
}

module.exports = {
    createExcludeMatcher,
    normalizePatterns
};
