'use strict';
const crypto = require('crypto');
const db = require('../../profile-db');

class HostTrust {
    constructor(emit) { this.emit = emit; }

    verifier(host, { sessionId, signal } = {}) {
        // ssh2 uses function arity to distinguish sync vs async hostVerifier.
        return (rawKey, callback) => {
            if (signal?.aborted) return callback(false);
            const address = String(host.address || '').trim();
            const port = Number(host.port || 22);
            const bytes = Buffer.isBuffer(rawKey) ? rawKey : Buffer.from(String(rawKey || ''), 'hex');
            if (!address || !bytes.length) return callback(false);
            const key = bytes.toString('hex');
            const fingerprint = `SHA256:${crypto.createHash('sha256').update(bytes).digest('base64').replace(/=+$/, '')}`;
            let changed = false;
            try {
                const profilePath = db.getActiveProfilePath();
                const stored = db.get('knownHosts');
                const hosts = Array.isArray(stored) ? stored : [];
                const previous = hosts.find(item => item.address === address && Number(item.port) === port);
                if (previous) {
                    changed = previous.key !== key;
                } else {
                    // Automatic first-use pinning avoids a prompt, but cannot authenticate
                    // the first connection independently of the network it uses.
                    if (signal?.aborted || db.getActiveProfilePath() !== profilePath) return callback(false);
                    hosts.push({ address, port, key, fingerprint, firstSeen: Date.now(), lastUpdated: Date.now() });
                    db.set('knownHosts', hosts);
                }
            } catch (_) { return callback(false); }
            callback(!changed && !signal?.aborted);
            if (changed) {
                try { this.emit('android:host-key', { sessionId, address, port, fingerprint, changed: true }); }
                catch (_) {}
            }
        };
    }

    close() {}
}
module.exports = { HostTrust };
