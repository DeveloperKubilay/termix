'use strict';
const fs = require('fs');
const path = require('path');

function inside(root, target) {
    const relative = path.relative(root, target);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

// The Android local file pane has its own root, never profiles or key material.
// Refuse symlink components, including dangling links; lexical containment alone
// is insufficient for writes to not-yet-existing children.
function safePath(root, input) {
    const base = path.resolve(root);
    const target = path.resolve(base, String(input || '.'));
    if (!inside(base, target)) throw Object.assign(new Error('Path is outside the Android local file sandbox.'), { code: 'ACCESS_DENIED' });
    const parts = path.relative(base, target).split(path.sep).filter(Boolean);
    let current = base;
    for (const part of ['', ...parts]) {
        if (part) current = path.join(current, part);
        try {
            if (fs.lstatSync(current).isSymbolicLink()) {
                throw Object.assign(new Error('Symbolic links are not allowed in Android private storage.'), { code: 'ACCESS_DENIED' });
            }
        } catch (err) {
            if (err.code !== 'ENOENT') throw err;
        }
    }
    return target;
}
module.exports = { inside, safePath };
