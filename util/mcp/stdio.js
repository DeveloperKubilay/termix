#!/usr/bin/env node
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { registerTools, closeSftpSessions } = require('./tools.js');

const SERVER_INFO = {
    name: 'termix',
    version: require('../../package.json').version || '1.0.0'
};

async function main() {
    const server = new McpServer(SERVER_INFO, {
        capabilities: { tools: {} },
        instructions: 'Termix MCP Server. Gives AI assistants direct access to list saved hosts, run commands over SSH, and manage SFTP files.'
    });

    registerTools(server, {
        openTerminalInUi: () => false
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);

    const cleanup = async () => {
        try {
            await closeSftpSessions();
            await server.close();
        } catch (_) {}
        process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
}

main().catch((err) => {
    console.error('Fatal MCP stdio server error:', err);
    process.exit(1);
});
