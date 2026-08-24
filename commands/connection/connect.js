const newConnection = require('../../util/terminal/newconnection');
const sessionStore = require('../../util/mcp/session-store');

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

        // Mirror the session so MCP tools can list it and read its output.
        sessionStore.register(connection.sessionId, hostInfo, 'ui');

        const safeSend = (channel, payload) => {
            if (event && event.sender && !event.sender.isDestroyed()) {
                try {
                    event.sender.send(channel, payload);
                } catch (_) {}
            }
        };

        // Bridge: Backend (SSH) -> Frontend (IPC)
        connection.on('data', (msg) => {
            if (msg.type === 'data') {
                sessionStore.appendOutput(connection.sessionId, msg.data);
                safeSend('term-data', { sessionId: connection.sessionId, data: msg.data });
            } else if (msg.type === 'connected') {
                safeSend('ssh-ready', { sessionId: connection.sessionId });
            } else if (msg.type === 'error') {
                safeSend('term-error', { sessionId: connection.sessionId, message: msg.message });
            } else if (msg.type === 'disconnected') {
                safeSend('term-disconnected', {
                    sessionId: connection.sessionId,
                    exitCode: msg.exitCode,
                    signal: msg.signal,
                    message: msg.message
                });
                try {
                    sessionStore.remove(connection.sessionId);
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
