const sshConnection = require('../connections/ssh');
const serialConnection = require('../connections/serial');
const localConnection = require('../connections/local');

module.exports = (data) => {
    // Determine protocol. Default to SSH if not specified or unrecognized for now
    const protocol = (data.protocol || 'SSH').toUpperCase();

    switch (protocol) {
        case 'SSH':
        case 'SFTP': 
            return sshConnection(data);
        
        case 'SERIAL':
            return serialConnection(data);
            
        case 'LOCAL':
        case 'TERMINAL':
            return localConnection(data);
            
        default:
            console.warn(`Unknown protocol ${protocol}, defaulting to SSH`);
            return sshConnection(data);
    }
};
