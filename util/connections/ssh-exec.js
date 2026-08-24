// One-shot SSH command execution with a small connection pool, used by the
// MCP tools. Interactive shells keep using connections/ssh.js.
const { Client } = require('ssh2');
const { buildConnectConfig } = require('./ssh-common');

const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes idle connection reuse
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 600000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

const pool = new Map();

function poolKey(host) {
    return `${host.username || ''}@${host.address || ''}:${host.port || 22}`;
}

function releaseLater(key) {
    const entry = pool.get(key);
    if (!entry) return;

    clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
        if (entry.busy) return;
        pool.delete(key);
        try { entry.conn.end(); } catch (_) {}
    }, IDLE_TIMEOUT_MS);

    // Do not hold the process open just to keep an idle SSH socket around.
    if (typeof entry.idleTimer.unref === 'function') entry.idleTimer.unref();
}

function connect(host) {
    return new Promise((resolve, reject) => {
        let config;
        try {
            config = buildConnectConfig(host, () => {});
        } catch (err) {
            reject(err);
            return;
        }

        const conn = new Client();
        let settled = false;

        conn.on('ready', () => {
            if (settled) return;
            settled = true;
            resolve(conn);
        });

        conn.on('error', (err) => {
            if (!settled) {
                settled = true;
                reject(err);
                return;
            }
            dropFromPool(conn);
        });

        conn.on('close', () => dropFromPool(conn));

        try {
            conn.connect(config);
        } catch (err) {
            if (!settled) {
                settled = true;
                reject(err);
            }
        }
    });
}

function dropFromPool(conn) {
    for (const [key, entry] of pool.entries()) {
        if (entry.conn === conn) {
            clearTimeout(entry.idleTimer);
            pool.delete(key);
        }
    }
}

async function acquire(host) {
    const key = poolKey(host);
    const existing = pool.get(key);
    if (existing && !existing.busy) {
        clearTimeout(existing.idleTimer);
        existing.busy = true;
        return existing;
    }

    const conn = await connect(host);
    const entry = { conn, busy: true, idleTimer: null };

    // A second caller may have populated the pool while we were connecting; the
    // newest connection wins and the older one is closed on release.
    pool.set(key, entry);
    return entry;
}

function release(host, entry) {
    entry.busy = false;
    const key = poolKey(host);
    if (pool.get(key) !== entry) {
        try { entry.conn.end(); } catch (_) {}
        return;
    }
    releaseLater(key);
}

function normalizeTimeout(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_TIMEOUT_MS;
    return Math.min(Math.round(parsed), MAX_TIMEOUT_MS);
}

function prepareCommand(command) {
    const raw = String(command || '').trim();
    if (!raw) return raw;
    const envPreamble = 'export PATH="$PATH:/usr/local/bin:/usr/local/sbin:~/.local/bin:~/.cargo/bin"; [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" 2>/dev/null; [ -s "$HOME/.fnm/fnm" ] && eval "$($HOME/.fnm/fnm env)" 2>/dev/null; [ -s "$HOME/.volta/bin" ] && export PATH="$HOME/.volta/bin:$PATH"; ';
    return `${envPreamble}${raw}`;
}

// Runs `command` on `host` and resolves with the captured output. Output is
// capped so that a runaway command cannot exhaust memory.
async function runCommand(host, command, options = {}) {
    const timeoutMs = normalizeTimeout(options.timeoutMs);
    const entry = await acquire(host);

    try {
        return await new Promise((resolve, reject) => {
            let stdout = '';
            let stderr = '';
            let truncated = false;
            let finished = false;
            let timer = null;

            const append = (target, chunk) => {
                const text = chunk.toString('utf8');
                if (target === 'out') {
                    if (stdout.length + text.length > MAX_OUTPUT_BYTES) {
                        stdout += text.slice(0, Math.max(0, MAX_OUTPUT_BYTES - stdout.length));
                        truncated = true;
                    } else {
                        stdout += text;
                    }
                } else if (stderr.length + text.length > MAX_OUTPUT_BYTES) {
                    stderr += text.slice(0, Math.max(0, MAX_OUTPUT_BYTES - stderr.length));
                    truncated = true;
                } else {
                    stderr += text;
                }
            };

            const finish = (result, err) => {
                if (finished) return;
                finished = true;
                clearTimeout(timer);
                if (err) reject(err);
                else resolve(result);
            };

            const fullCommand = prepareCommand(command);
            entry.conn.exec(fullCommand, { pty: false }, (err, stream) => {
                if (err) {
                    finish(null, err);
                    return;
                }

                timer = setTimeout(() => {
                    try { stream.close(); } catch (_) {}
                    finish({
                        stdout,
                        stderr,
                        exitCode: null,
                        signal: null,
                        timedOut: true,
                        truncated
                    });
                }, timeoutMs);

                stream.on('data', (chunk) => append('out', chunk));
                stream.stderr.on('data', (chunk) => append('err', chunk));
                stream.on('close', (code, signal) => {
                    finish({
                        stdout,
                        stderr,
                        exitCode: Number.isFinite(Number(code)) ? Number(code) : null,
                        signal: signal || null,
                        timedOut: false,
                        truncated
                    });
                });
                stream.on('error', (streamErr) => finish(null, streamErr));
            });
        });
    } finally {
        release(host, entry);
    }
}

function closeAll() {
    for (const [key, entry] of pool.entries()) {
        clearTimeout(entry.idleTimer);
        pool.delete(key);
        try { entry.conn.end(); } catch (_) {}
    }
}

module.exports = {
    runCommand,
    closeAll,
    DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS
};
