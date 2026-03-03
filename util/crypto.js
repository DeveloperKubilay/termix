const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { machineIdSync } = require('node-machine-id');
const { PROFILES_DIR } = require('./paths');

const PORTABLE_KEY_ENV = 'TERMIX_PORTABLE_KEY';
const PORTABLE_KEY_FILE = path.join(PROFILES_DIR, '.termix-portable-key');

function getPortableKey() {
    let material = process.env[PORTABLE_KEY_ENV] || '';
    if (!material) {
        if (!fs.existsSync(PORTABLE_KEY_FILE)) {
            const keyDir = path.dirname(PORTABLE_KEY_FILE);
            if (!fs.existsSync(keyDir)) fs.mkdirSync(keyDir, { recursive: true });
            const generated = crypto.randomBytes(48).toString('base64');
            fs.writeFileSync(PORTABLE_KEY_FILE, `${generated}\n`, { encoding: 'utf8', mode: 0o600 });
        }
        material = fs.readFileSync(PORTABLE_KEY_FILE, 'utf8').trim();
    }
    return crypto.scryptSync(material, 'TermixGlobalSalt', 32); 
}

const machineID = machineIdSync();
const oldMachineKey = crypto.createHash('sha256').update(machineID+"Termix").digest().slice(0, 32);
const newPortableKey = getPortableKey();

function encrypt(text) {
    if (!text) return text;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', newPortableKey, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return 'ptb:' + iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
    if (!text) return text;
    try {
        if (text.startsWith('ptb:')) {
            const payload = text.slice(4);
            const parts = payload.split(':');
            const iv = Buffer.from(parts[0], 'hex');
            const encryptedText = Buffer.from(parts[1], 'hex');
            const decipher = crypto.createDecipheriv('aes-256-cbc', newPortableKey, iv);
            const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
            return decrypted.toString('utf8');
        } else {
            const parts = text.split(':');
            const iv = Buffer.from(parts[0], 'hex');
            const encryptedText = Buffer.from(parts.join(':'), 'hex');
            const decipher = crypto.createDecipheriv('aes-256-cbc', oldMachineKey, iv);
            const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
            return decrypted.toString('utf8');
        }
    } catch (error) {
        return "ERROR: This cipher cannot be decrypted! 🚫";
    }
}

module.exports = { encrypt, decrypt };

if (require.main === module) {

    console.log(`Machine ID: ${machineID} 🧠`);
    const message = "Only my computer can read this";
    console.log(`Original: ${message} 😎`);
    const encrypted = encrypt(message);
    console.log(`Encrypted: ${encrypted} 🔒`);
    const decrypted = decrypt(encrypted);
    console.log(`Decrypted: ${decrypted} 🔓`);
}