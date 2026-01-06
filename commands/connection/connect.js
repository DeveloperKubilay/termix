const newConnection = require('../../util/terminal/newconnection');

module.exports = async (filesPath, hostInfo, event) => {
    console.log('Connect request:', hostInfo.name);

    try {
        const connection = await newConnection(hostInfo);
        
        // Ensure global.Terminals exists (it is defined in index.js)
        if (!global.Terminals) global.Terminals = {};
        global.Terminals[connection.sessionId] = connection;

        // Bridge: Backend (SSH) -> Frontend (IPC)
        connection.on('data', (msg) => {
            if (msg.type === 'data') {
                event.sender.send('term-data', { sessionId: connection.sessionId, data: msg.data });
            } else if (msg.type === 'connected') {
                event.sender.send('ssh-ready', { sessionId: connection.sessionId });
            } else if (msg.type === 'error') {
                event.sender.send('term-error', { sessionId: connection.sessionId, message: msg.message });
            }
        });

        // Return session info to frontend
        return { 
            status: 'connected', 
            sessionId: connection.sessionId 
        };
    } catch (err) {
        console.error("Connection failed:", err);
        return { status: 'error', message: err.message };
    }
};
