const mcpServer = require('../../util/mcp/server');

module.exports = async () => ({ success: true, status: mcpServer.getStatus() });
