'use strict';
const crypto = require('crypto');
const db = require('../../profile-db');

class HostTrust {
    constructor(emit, { timeoutMs = 60000 } = {}) {
        this.emit = emit;
        this.timeoutMs = timeoutMs;
        this.pending = new Map();
    }
    verifier(host, { sessionId, signal } = {}) {
        // ssh2 uses function arity to distinguish sync vs async hostVerifier.
        return (rawKey, callback) => {
            if (signal && signal.aborted) return callback(false);
            const address = String(host.address || '').trim();
            const port = Number(host.port || 22);
            const key = Buffer.isBuffer(rawKey) ? rawKey.toString('hex') : String(rawKey || '');
            const fingerprint = `SHA256:${crypto.createHash('sha256').update(Buffer.isBuffer(rawKey) ? rawKey : Buffer.from(key, 'hex')).digest('base64').replace(/=+$/, '')}`;
            try {
                const current = db.get('knownHosts');
                const hosts = Array.isArray(current) ? current : [];
                const index = hosts.findIndex((item) => item.address === address && Number(item.port) === port);
                const previous = index !== -1 ? hosts[index] : null;
                const record = {
                    address,
                    port,
                    key,
                    fingerprint,
                    firstSeen: previous ? previous.firstSeen : Date.now(),
                    lastUpdated: Date.now()
                };
                if (index === -1) {
                    hosts.push(record);
                } else {
                    hosts[index] = record;
                }
                db.set('knownHosts', hosts);
            } catch (_) {}
            return callback(true);
        };
    }
    approve(payload = {}) {
        return { success: true };
    }
    close() {
        this.pending.clear();
    }
}
module.exports = { HostTrust };
