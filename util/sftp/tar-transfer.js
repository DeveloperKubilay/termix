// Fast path for folders with many files: instead of paying SFTP round trips per
// file, stream one tar archive through a single SSH exec channel. Falls back to
// the SFTP path when the remote host has no tar.
const tar = require('tar');

const TAR_EXEC_TIMEOUT_MS = 15000;

// Quotes a path for a POSIX shell: wrap in single quotes and escape any of its
// own single quotes.
function shellQuote(value) {
    return `'${String(value == null ? '' : value).replace(/'/g, `'\\''`)}'`;
}

function execCommand(conn, command, timeoutMs = TAR_EXEC_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            reject(new Error('Remote command timed out.'));
        }, timeoutMs);

        conn.exec(command, { pty: false }, (err, stream) => {
            if (err) {
                clearTimeout(timer);
                if (!settled) {
                    settled = true;
                    reject(err);
                }
                return;
            }

            let stdout = '';
            let stderr = '';
            stream.on('data', (chunk) => { stdout += chunk.toString(); });
            stream.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
            stream.on('close', (code) => {
                clearTimeout(timer);
                if (settled) return;
                settled = true;
                resolve({ code: Number(code), stdout, stderr });
            });
        });
    });
}

// Checks once per session whether the host can pack/unpack tar archives.
async function detectRemoteTar(conn) {
    try {
        const result = await execCommand(conn, 'command -v tar >/dev/null 2>&1 && tar --version 2>/dev/null | head -1');
        return result.code === 0 && /tar/i.test(result.stdout);
    } catch (_) {
        return false;
    }
}

// Counts the regular files under a remote directory, used to verify that a tar
// stream landed everything it was supposed to.
async function countRemoteFiles(conn, targetPath) {
    const result = await execCommand(conn, `find ${shellQuote(targetPath)} -type f | wc -l`, 60000);
    if (result.code !== 0) return null;
    const parsed = Number(String(result.stdout).trim());
    return Number.isFinite(parsed) ? parsed : null;
}

function buildExcludeArgs(patterns) {
    if (!Array.isArray(patterns) || !patterns.length) return '';
    return patterns
        .map(pattern => ` --exclude=${shellQuote(pattern)}`)
        .join('');
}

// Streams the contents of a local directory into an existing remote directory.
function uploadDirectory(conn, sourcePath, destinationPath, options = {}) {
    const { onBytes = null, filter = null, excludePatterns = [] } = options;

    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (err, value) => {
            if (settled) return;
            settled = true;
            if (err) reject(err);
            else resolve(value);
        };

        const command = `tar -xzf - --no-same-owner -C ${shellQuote(destinationPath)}`;

        conn.exec(command, { pty: false }, (err, channel) => {
            if (err) {
                finish(err);
                return;
            }

            let stderr = '';
            channel.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
            // Nothing reads the remote tar's stdout, but it must still be
            // drained or the channel stalls and never closes.
            channel.on('data', () => {});

            channel.on('close', (code) => {
                const exitCode = Number(code);
                if (exitCode === 0) {
                    finish(null, { transport: 'tar' });
                    return;
                }
                finish(new Error(`Remote tar failed (exit ${exitCode}): ${stderr.trim() || 'no output'}`));
            });

            let packer;
            try {
                packer = tar.c({
                    cwd: sourcePath,
                    gzip: true,
                    portable: true,
                    // The SFTP path follows symlinks and copies their target's
                    // contents; keep both paths behaving the same way.
                    follow: true,
                    // Report raw (uncompressed) bytes so progress matches the
                    // size the caller measured while walking the tree.
                    onReadEntry: (entry) => {
                        if (onBytes) onBytes(Number(entry.size || 0));
                    },
                    filter: typeof filter === 'function' ? filter : undefined
                }, ['.']);
            } catch (packErr) {
                finish(packErr);
                return;
            }

            packer.on('error', (packErr) => {
                try { channel.end(); } catch (_) {}
                finish(packErr);
            });

            packer.pipe(channel);
        });

        // The caller cannot see the exclude list from inside node-tar's filter,
        // so it is only used on the download side; keep the signature aligned.
        void excludePatterns;
    });
}

// Streams a remote directory's contents into an existing local directory.
function downloadDirectory(conn, sourcePath, destinationPath, options = {}) {
    const { onBytes = null, excludePatterns = [] } = options;

    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (err, value) => {
            if (settled) return;
            settled = true;
            if (err) reject(err);
            else resolve(value);
        };

        const command = `tar -czhf -${buildExcludeArgs(excludePatterns)} -C ${shellQuote(sourcePath)} .`;

        conn.exec(command, { pty: false }, (err, channel) => {
            if (err) {
                finish(err);
                return;
            }

            let stderr = '';
            let extractFailed = false;
            channel.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

            const extractor = tar.x({
                cwd: destinationPath,
                onReadEntry: (entry) => {
                    if (onBytes) onBytes(Number(entry.size || 0));
                }
            });

            extractor.on('error', (extractErr) => {
                extractFailed = true;
                try { channel.close(); } catch (_) {}
                finish(extractErr);
            });

            extractor.on('finish', () => {
                if (extractFailed) return;
                finish(null, { transport: 'tar' });
            });

            channel.on('close', (code) => {
                const exitCode = Number(code);
                // tar reports 1 for "file changed as we read it", which is not
                // fatal for a copy; anything higher is.
                if (exitCode > 1 && !extractFailed) {
                    extractFailed = true;
                    finish(new Error(`Remote tar failed (exit ${exitCode}): ${stderr.trim() || 'no output'}`));
                }
            });

            channel.pipe(extractor);
        });
    });
}

module.exports = {
    detectRemoteTar,
    countRemoteFiles,
    uploadDirectory,
    downloadDirectory,
    shellQuote
};
