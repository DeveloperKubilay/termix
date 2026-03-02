const http = require('http');
const https = require('https');
const { URL } = require('url');
const db = require('./profile-db');
const { encrypt, decrypt } = require('./crypto');

function getQmmConfig() {
    const rawConfig = db.get('config') || {};
    const baseUrl = String(rawConfig.url || rawConfig.baseUrl || '').trim();
    const apiKey = String(rawConfig.password || rawConfig.apiKey || '').trim();
    const allowSelfSigned = rawConfig.allowSelfSigned !== false;

    if (!baseUrl) {
        throw new Error('QMM URL is required.');
    }

    if (!apiKey) {
        throw new Error('QMM password (API key) is required.');
    }

    return {
        hostsUrl: buildHostsUrl(baseUrl),
        apiKey,
        allowSelfSigned
    };
}

function buildHostsUrl(rawUrl) {
    let normalized = String(rawUrl || '').trim();
    if (!normalized) {
        throw new Error('QMM URL is required.');
    }

    if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(normalized)) {
        normalized = `https://${normalized}`;
    }

    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('QMM URL must use http:// or https://');
    }

    const pathName = parsed.pathname.replace(/\/+$/g, '');
    if (!pathName) {
        parsed.pathname = '/api/hosts';
    } else if (!pathName.toLowerCase().endsWith('/api/hosts')) {
        parsed.pathname = `${pathName}/api/hosts`;
    } else {
        parsed.pathname = pathName;
    }

    parsed.search = '';
    parsed.hash = '';

    return parsed;
}

function buildDeleteUrl(hostsUrl, hostId) {
    const out = new URL(hostsUrl.toString());
    const basePath = out.pathname.replace(/\/+$/g, '');
    out.pathname = `${basePath}/${encodeURIComponent(String(hostId))}`;
    return out;
}

function requestJson(method, targetUrl, options = {}) {
    const isHttps = targetUrl.protocol === 'https:';
    const client = isHttps ? https : http;
    const headers = {
        Accept: 'application/json'
    };

    if (options.apiKey) {
        headers['x-api-key'] = options.apiKey;
    }

    let bodyRaw = null;
    if (typeof options.body !== 'undefined') {
        bodyRaw = JSON.stringify(options.body);
        headers['Content-Type'] = 'application/json';
        headers['Content-Length'] = Buffer.byteLength(bodyRaw);
    }

    return new Promise((resolve, reject) => {
        const req = client.request(
            targetUrl,
            {
                method,
                headers,
                rejectUnauthorized: isHttps ? !options.allowSelfSigned : true
            },
            (res) => {
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    const raw = Buffer.concat(chunks).toString('utf8').trim();
                    let payload = null;

                    if (raw) {
                        try {
                            payload = JSON.parse(raw);
                        } catch (_) {
                            payload = raw;
                        }
                    }

                    if (res.statusCode >= 400) {
                        const errMessage = payload && typeof payload === 'object'
                            ? (payload.error || payload.message)
                            : null;
                        reject(new Error(errMessage || `QMM request failed (${res.statusCode})`));
                        return;
                    }

                    resolve(payload);
                });
            }
        );

        req.on('error', reject);

        if (bodyRaw) {
            req.write(bodyRaw);
        }

        req.end();
    });
}

function decodeLocalPassword(value) {
    const text = value == null ? '' : String(value);
    if (!text) return '';

    const decrypted = decrypt(text);
    if (typeof decrypted === 'string' && !decrypted.startsWith('ERROR:')) {
        return decrypted;
    }

    return text;
}

function encodeLocalPassword(value) {
    const text = value == null ? '' : String(value);
    if (!text) return '';

    try {
        return encrypt(text);
    } catch (_) {
        return text;
    }
}

function normalizeTags(tags) {
    if (!Array.isArray(tags)) return [];
    return tags
        .map((tag) => String(tag || '').trim())
        .filter(Boolean);
}

function toQmmHost(host = {}) {
    const address = String(host.address || host.ip || '').trim();
    const username = String(host.username || 'root').trim() || 'root';
    const protocol = String(host.protocol || 'ssh').toLowerCase().trim() || 'ssh';
    const name = String(host.name || address || 'Unnamed Server').trim();
    const certs = Array.isArray(host.certs)
        ? host.certs.filter(Boolean).map((item) => String(item))
        : (host.certPath ? [String(host.certPath)] : []);

    return {
        name,
        protocol,
        address,
        username,
        password: decodeLocalPassword(host.password),
        port: String(host.port || '22'),
        tags: normalizeTags(host.tags),
        certs
    };
}

function toLocalHost(host = {}, index = 0) {
    const address = String(host.address || host.ip || '').trim();
    const protocol = String(host.protocol || 'ssh').toLowerCase().trim() || 'ssh';
    const certPath = host.certPath
        ? String(host.certPath)
        : (Array.isArray(host.certs) && host.certs.length ? String(host.certs[0]) : '');
    const numericId = Number(host.id);

    return {
        id: Number.isFinite(numericId) ? numericId : Date.now() + index,
        name: String(host.name || address || `Host ${index + 1}`).trim(),
        icon: String(host.icon || 'fa-brands fa-linux'),
        color: String(host.color || '#89b4fa'),
        protocol,
        username: String(host.username || 'root').trim() || 'root',
        password: encodeLocalPassword(host.password),
        address,
        port: String(host.port || '22'),
        tags: normalizeTags(host.tags),
        certPath
    };
}

function collectTags(hosts = []) {
    const tags = new Set();
    for (const host of hosts) {
        for (const tag of normalizeTags(host.tags)) {
            tags.add(tag);
        }
    }
    return Array.from(tags);
}

async function pullFromQmm(config) {
    const remoteHosts = await requestJson('GET', config.hostsUrl, {
        apiKey: config.apiKey,
        allowSelfSigned: config.allowSelfSigned
    });

    if (!Array.isArray(remoteHosts)) {
        throw new Error('QMM response is invalid. Expected an array of hosts.');
    }

    const hosts = remoteHosts.map((item, index) => toLocalHost(item, index));
    const tags = collectTags(hosts);

    db.set('hosts', hosts);
    db.set('tags', tags);

    return {
        success: true,
        mode: 'pull',
        provider: 'qmm',
        hostsCount: hosts.length,
        tagsCount: tags.length
    };
}

async function pushToQmm(config) {
    const localHostsRaw = db.get('hosts');
    const localHosts = Array.isArray(localHostsRaw) ? localHostsRaw : [];
    const remoteHosts = await requestJson('GET', config.hostsUrl, {
        apiKey: config.apiKey,
        allowSelfSigned: config.allowSelfSigned
    });

    const remoteList = Array.isArray(remoteHosts) ? remoteHosts : [];
    let deletedCount = 0;
    for (const host of remoteList) {
        if (!host || typeof host.id === 'undefined' || host.id === null) {
            continue;
        }

        await requestJson('DELETE', buildDeleteUrl(config.hostsUrl, host.id), {
            apiKey: config.apiKey,
            allowSelfSigned: config.allowSelfSigned
        });
        deletedCount += 1;
    }

    let pushedCount = 0;
    for (const host of localHosts) {
        const payload = toQmmHost(host);
        if (!payload.address) {
            continue;
        }

        await requestJson('POST', config.hostsUrl, {
            apiKey: config.apiKey,
            allowSelfSigned: config.allowSelfSigned,
            body: payload
        });
        pushedCount += 1;
    }

    return {
        success: true,
        mode: 'push',
        provider: 'qmm',
        deletedCount,
        pushedCount
    };
}

module.exports = async function syncQmm(upload) {
    const type = String(db.get('type') || '').toLowerCase();
    if (type !== 'qmm') {
        throw new Error('Active profile is not configured for QMM.');
    }

    const config = getQmmConfig();
    if (upload) {
        return pushToQmm(config);
    }
    return pullFromQmm(config);
};
