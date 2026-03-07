/**
 * scripts/build-android-web.js
 *
 * Bundles the Termix web UI into the www/ directory so Capacitor can sync
 * it into the Android project's assets.
 *
 * What it does:
 *   1. Copies the app HTML, CSS, and JS files to www/
 *   2. Copies xterm.js libraries from node_modules into www/node_modules/
 *   3. Produces www/index.html ready to be served from a Capacitor WebView
 *
 * Usage:
 *   node scripts/build-android-web.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WWW = path.join(ROOT, 'www');

// ─── Utilities ───────────────────────────────────────────────────────────────

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
    ensureDir(dest);
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(srcPath, destPath);
        } else {
            copyFile(srcPath, destPath);
        }
    }
}

// ─── Main ────────────────────────────────────────────────────────────────────

console.log('Building Android web assets into www/ ...');

ensureDir(WWW);

// 1. Copy index.html (same as the Electron version - platform.js handles differences)
copyFile(path.join(ROOT, 'index.html'), path.join(WWW, 'index.html'));

// 2. Copy the public/ directory (app.js, style.css, modules/, platform.js, icons/)
copyDir(path.join(ROOT, 'public'), path.join(WWW, 'public'));

// 3. Copy xterm.js libraries that index.html references from node_modules/
const XTERM_LIBS = [
    ['xterm/css/xterm.css',                     'xterm/css/xterm.css'],
    ['xterm/lib/xterm.js',                      'xterm/lib/xterm.js'],
    ['xterm-addon-fit/lib/xterm-addon-fit.js',  'xterm-addon-fit/lib/xterm-addon-fit.js'],
    ['xterm-addon-webgl/lib/xterm-addon-webgl.js', 'xterm-addon-webgl/lib/xterm-addon-webgl.js'],
];

for (const [src, dest] of XTERM_LIBS) {
    const srcPath = path.join(ROOT, 'node_modules', src);
    const destPath = path.join(WWW, 'node_modules', dest);
    if (fs.existsSync(srcPath)) {
        copyFile(srcPath, destPath);
        console.log(`  copied node_modules/${src}`);
    } else {
        console.warn(`  WARNING: ${srcPath} not found — skipping`);
    }
}

console.log('Done! Web assets written to www/');
console.log('Next: run  npx cap sync android  to copy them into the Android project.');
