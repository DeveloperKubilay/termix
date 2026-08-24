const mcpServer = require('../../util/mcp/server');

module.exports = async () => {
    const settings = mcpServer.ensureToken();
    return {
        success: true,
        settings,
        status: mcpServer.getStatus(),
        clientConfig: mcpServer.getClientConfig()
    };
};
