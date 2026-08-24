// Connection helpers shared by the interactive SSH shell and the one-shot
// command runner used by the MCP server.
const fs = require('fs');
const path = require('path');
const db = require('../profile-db');

const SSH_PORT_MIN = 1;
const SSH_PORT_MAX = 65535;
const SSH_PORT_FALLBACK = 22;
const SSH_READY_TIMEOUT_MS = 20000;
const SSH_KEEPALIVE_INTERVAL_MS = 10000;
const SSH_KEEPALIVE_COUNT_MAX = 6;

const SSH_CIPHERS = [
    'aes128-ctr',
    'aes192-ctr',
    'aes256-ctr',
    'aes128-gcm',
    'aes256-gcm',
    'aes128-cbc',
    'aes256-cbc',
    '3des-cbc'
];

function parseSshPort(value, fallback = SSH_PORT_FALLBACK) {
    const candidate = value == null || String(value).trim() === '' ? fallback : value;
    const parsed = Number(candidate);
    if (!Number.isInteger(parsed) || parsed < SSH_PORT_MIN || parsed > SSH_PORT_MAX) {
        throw new Error(`SSH port must be between ${SSH_PORT_MIN} and ${SSH_PORT_MAX}.`);
    }
    return parsed;
}

function loadPrivateKey(certPath) {
    const normalizedPath = String(certPath || '').trim();
    if (!normalizedPath) return null;

    let keyPath = normalizedPath;
    if (!path.isAbsolute(keyPath)) {
        const relativeInFiles = path.join(process.cwd(), 'files', keyPath);
        if (fs.existsSync(relativeInFiles)) {
            keyPath = relativeInFiles;
        }
    }

    return fs.readFileSync(keyPath);
}

function verifyAndPersistHost(data, port, hashedKey) {
    const key = Buffer.isBuffer(hashedKey)
        ? hashedKey.toString('hex')
        : String(hashedKey || '');

    let knownHosts;
    try {
        knownHosts = db.get('knownHosts');
    } catch (_) {
        knownHosts = [];
    }

    if (!Array.isArray(knownHosts)) {
        knownHosts = [];
    }

    const hostIndex = knownHosts.findIndex((item) => {
        return item.address === data.address && Number(item.port) === port;
    });

    if (hostIndex !== -1) {
        if (knownHosts[hostIndex].key === key) {
            return true;
        }
        // Host key changed (e.g. server was reinstalled/rebuilt).
        // Automatically update the stored key so connection succeeds smoothly.
        knownHosts[hostIndex].key = key;
        knownHosts[hostIndex].lastUpdated = Date.now();
        try {
            db.set('knownHosts', knownHosts);
        } catch (err) {
            console.error('Failed to update known_hosts:', err);
        }
        return true;
    }

    knownHosts.push({
        address: data.address,
        port,
        key,
        firstSeen: Date.now()
    });

    try {
        db.set('knownHosts', knownHosts);
    } catch (err) {
        console.error('Failed to save known_hosts:', err);
    }

    return true;
}

// Builds an ssh2 connect config from a stored host record. `onHostKeyRejected`
// is invoked when the host key does not match the known_hosts entry.
function buildConnectConfig(data, onHostKeyRejected) {
    const port = parseSshPort(data.port);
    const config = {
        host: String(data.address || '').trim(),
        port,
        username: data.username,
        readyTimeout: SSH_READY_TIMEOUT_MS,
        keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
        keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
        hostVerifier: (hashedKey) => {
            const verified = verifyAndPersistHost(data, port, hashedKey);
            if (!verified && typeof onHostKeyRejected === 'function') {
                onHostKeyRejected();
            }
            return verified;
        },
        algorithms: {
            cipher: SSH_CIPHERS
        }
    };

    if (data.password) {
        config.password = data.password;
    }

    const certPath = String(data.certPath || '').trim();
    if (certPath) {
        try {
            config.privateKey = loadPrivateKey(certPath);
        } catch (err) {
            throw new Error(`Private key cannot be read: ${err.message}`);
        }
    }

    if (!config.password && !config.privateKey) {
        throw new Error('Selected host has no password or private key.');
    }

    if (!config.host) {
        throw new Error('Selected host has no address.');
    }

    return config;
}

module.exports = {
    SSH_PORT_MIN,
    SSH_PORT_MAX,
    SSH_PORT_FALLBACK,
    SSH_READY_TIMEOUT_MS,
    SSH_KEEPALIVE_INTERVAL_MS,
    SSH_KEEPALIVE_COUNT_MAX,
    SSH_CIPHERS,
    parseSshPort,
    loadPrivateKey,
    verifyAndPersistHost,
    buildConnectConfig
};
