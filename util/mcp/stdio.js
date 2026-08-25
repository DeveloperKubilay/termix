#!/usr/bin/env node
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { registerTools, closeSftpSessions } = require('./tools.js');

const http = require('http');

const SERVER_INFO = {
    name: 'termix',
    version: require('../../package.json').version || '1.0.0'
};

function openTerminalInUi(host) {
    return new Promise((resolve) => {
        const payload = JSON.stringify(host || {});
        const req = http.request({
            hostname: '127.0.0.1',
            port: 8790,
            path: '/api/open-terminal',
            method: 'POST',
            timeout: 1500,
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            resolve(res.statusCode === 200);
        });

        req.on('error', () => resolve(false));
        req.on('timeout', () => {
            req.destroy();
            resolve(false);
        });

        req.write(payload);
        req.end();
    });
}

async function main() {
    const server = new McpServer(SERVER_INFO, {
        capabilities: { tools: {} },
        instructions: 'Termix MCP Server. Gives AI assistants direct access to list saved hosts, run commands over SSH, and manage SFTP files.'
    });

    registerTools(server, {
        openTerminalInUi
    });

    const transport = new StdioServerTransport();
    await server.connect(transport);

    let idleTimer = null;
    const IDLE_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes idle auto-shutdown

    const cleanup = async () => {
        if (idleTimer) clearTimeout(idleTimer);
        try {
            await closeSftpSessions();
            await server.close();
        } catch (_) {}
        process.exit(0);
    };

    const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            cleanup();
        }, IDLE_TIMEOUT_MS);
        if (idleTimer && typeof idleTimer.unref === 'function') idleTimer.unref();
    };

    process.stdin.on('data', resetIdleTimer);
    process.stdin.on('end', cleanup);
    process.stdin.on('close', cleanup);
    process.on('disconnect', cleanup);
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    resetIdleTimer();
}

main().catch((err) => {
    console.error('Fatal MCP stdio server error:', err);
    process.exit(1);
});
