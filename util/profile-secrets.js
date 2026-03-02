const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { decrypt } = require('./crypto');

const QMM_SECRET_PREFIX = 'enc::portable::v1::';
const LEGACY_MACHINE_PREFIX = 'enc::machine::';
const PORTABLE_KEY_ENV = 'TERMIX_PORTABLE_KEY';
const PORTABLE_KEY_FILE = path.join(__dirname, '..', 'profiles', '.termix-portable-key');

function ensurePortableKeyMaterial() {
    const envKey = String(process.env[PORTABLE_KEY_ENV] || '').trim();
    if (envKey) {
        return envKey;
    }

    const keyDir = path.dirname(PORTABLE_KEY_FILE);
    if (!fs.existsSync(keyDir)) {
        fs.mkdirSync(keyDir, { recursive: true });
    }

    if (!fs.existsSync(PORTABLE_KEY_FILE)) {
        const generated = crypto.randomBytes(48).toString('base64');
        fs.writeFileSync(PORTABLE_KEY_FILE, `${generated}\n`, { encoding: 'utf8', mode: 0o600 });
    }

    return fs.readFileSync(PORTABLE_KEY_FILE, 'utf8').trim();
}

function derivePortableKey(saltBuffer) {
    const material = ensurePortableKeyMaterial();
    return crypto.scryptSync(material, saltBuffer, 32);
}

function encryptPortable(value) {
    const plainText = String(value || '');
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = derivePortableKey(salt);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

    const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${QMM_SECRET_PREFIX}${salt.toString('hex')}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decryptPortable(value) {
    const text = String(value || '').trim();
    if (!text.startsWith(QMM_SECRET_PREFIX)) return null;

    const payload = text.slice(QMM_SECRET_PREFIX.length);
    const parts = payload.split(':');
    if (parts.length !== 4) return null;

    try {
        const salt = Buffer.from(parts[0], 'hex');
        const iv = Buffer.from(parts[1], 'hex');
        const authTag = Buffer.from(parts[2], 'hex');
        const encrypted = Buffer.from(parts[3], 'hex');
        const key = derivePortableKey(salt);
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
        return decrypted.toString('utf8');
    } catch (_) {
        return null;
    }
}

function isLikelyLegacyCipher(value) {
    return /^[0-9a-f]+:[0-9a-f]+$/i.test(String(value || '').trim());
}

function tryDecryptMachineCipher(value) {
    const text = String(value || '').trim();
    if (!text) return null;

    const decrypted = decrypt(text);
    if (typeof decrypted === 'string' && !decrypted.startsWith('ERROR:')) {
        return decrypted;
    }

    return null;
}

function sealQmmSecret(value) {
    const text = String(value || '').trim();
    if (!text) return '';

    const portablePlain = decryptPortable(text);
    if (portablePlain !== null) {
        return text;
    }

    if (text.startsWith(LEGACY_MACHINE_PREFIX)) {
        const legacyCipher = text.slice(LEGACY_MACHINE_PREFIX.length);
        const decryptedLegacy = tryDecryptMachineCipher(legacyCipher);
        if (decryptedLegacy !== null) {
            return encryptPortable(decryptedLegacy);
        }
        return text;
    }

    const decryptedLegacy = tryDecryptMachineCipher(text);
    if (decryptedLegacy !== null) {
        return encryptPortable(decryptedLegacy);
    }

    if (isLikelyLegacyCipher(text)) {
        return text;
    }

    return encryptPortable(text);
}

function unsealQmmSecret(value) {
    const text = String(value || '').trim();
    if (!text) return '';

    const portable = decryptPortable(text);
    if (portable !== null) {
        return portable;
    }

    if (text.startsWith(LEGACY_MACHINE_PREFIX)) {
        const legacyCipher = text.slice(LEGACY_MACHINE_PREFIX.length);
        return tryDecryptMachineCipher(legacyCipher) || '';
    }

    const legacy = tryDecryptMachineCipher(text);
    if (legacy !== null) {
        return legacy;
    }

    if (isLikelyLegacyCipher(text)) {
        return '';
    }

    return text;
}

function normalizeCloudConfig(type, config) {
    const normalizedType = String(type || '').toLowerCase().trim();
    if (normalizedType !== 'firebase' && normalizedType !== 'qmm') {
        return {};
    }

    const out = config && typeof config === 'object' && !Array.isArray(config)
        ? { ...config }
        : {};

    if (normalizedType === 'qmm') {
        const rawSecret = String(out.password || out.apiKey || '').trim();
        if (rawSecret) {
            out.password = sealQmmSecret(rawSecret);
        } else {
            delete out.password;
        }
        delete out.apiKey;
    }

    return out;
}

module.exports = {
    normalizeCloudConfig,
    sealQmmSecret,
    unsealQmmSecret,
    QMM_SECRET_PREFIX,
    PORTABLE_KEY_ENV,
    PORTABLE_KEY_FILE
};
