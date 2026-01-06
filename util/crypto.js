const crypto = require('crypto');
const { machineIdSync } = require('node-machine-id');

const machineID = machineIdSync();

const key = crypto.createHash('sha256').update(machineID).digest().slice(0, 32);

function encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
    try {
        const parts = text.split(':');
        const iv = Buffer.from(parts.shift(), 'hex');
        const encryptedText = Buffer.from(parts.join(':'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        const decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
        return decrypted.toString('utf8');
    } catch (error) {
        return "ERROR: This cipher cannot be decrypted on this machine! 🚫";
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