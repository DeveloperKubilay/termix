const mcpServer = require('../../util/mcp/server');

module.exports = async (filesPath, payload = {}) => {
    try {
        const current = mcpServer.readSettings();
        const next = mcpServer.writeSettings({ ...current, ...payload, token: current.token });
        const status = await mcpServer.restart();

        return {
            success: true,
            settings: next,
            status: { ...mcpServer.getStatus(), ...status },
            clientConfig: mcpServer.getClientConfig()
        };
    } catch (err) {
        return { success: false, message: err && err.message ? err.message : String(err) };
    }
};
