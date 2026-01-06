const newConnection = require('../../util/terminal/newconnection');

module.exports = async (filesPath, hostInfo, event) => {
    // Better logging
    const protocol = hostInfo.protocol ? hostInfo.protocol.toUpperCase() : 'SSH';
    const target = hostInfo.address || hostInfo.path || 'localhost';
    console.log(`Connect request: ${protocol}@${target}`);

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
            } else if (msg.type === 'disconnected') {
                event.sender.send('term-disconnected', { sessionId: connection.sessionId, exitCode: msg.exitCode });
                try {
                    if (global.Terminals && global.Terminals[connection.sessionId]) {
                        delete global.Terminals[connection.sessionId];
                    }
                } catch (e) {
                    console.error('Error cleaning session:', e);
                }
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
