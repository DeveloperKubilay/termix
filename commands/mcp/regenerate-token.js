const mcpServer = require('../../util/mcp/server');

module.exports = async () => {
    try {
        const settings = mcpServer.regenerateToken();
        return {
            success: true,
            settings,
            status: mcpServer.getStatus(),
            clientConfig: mcpServer.getClientConfig()
        };
    } catch (err) {
        return { success: false, message: err && err.message ? err.message : String(err) };
    }
};
