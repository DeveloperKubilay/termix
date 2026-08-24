// Local MCP endpoint. Assistants (Claude Code, Claude Desktop, Cursor, ...)
// connect over Streamable HTTP on the loopback interface and drive the tools in
// ./tools.js. Disabled until the user turns it on in Settings > MCP.
const http = require('http');
const crypto = require('crypto');

const db = require('../profile-db');
const { normalizeMcpSettings } = require('../profile-defaults');
const { registerTools, closeSftpSessions } = require('./tools');

const HOST = '127.0.0.1';
const MCP_PATH = '/mcp';
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const SERVER_INFO = {
    name: 'termix',
    version: require('../../package.json').version || '1.0.0'
};

let httpServer = null;
let runtimeState = {
    running: false,
    port: null,
    error: null,
    startedAt: null
};
let contextRef = {};

function readSettings() {
    return normalizeMcpSettings(db.get('mcp'));
}

function writeSettings(settings) {
    const normalized = normalizeMcpSettings(settings);
    db.set('mcp', normalized);
    return normalized;
}

function generateToken() {
    return crypto.randomBytes(24).toString('hex');
}

// Makes sure a token exists before the endpoint ever accepts a request.
function ensureToken() {
    const settings = readSettings();
    if (settings.token) return settings;
    settings.token = generateToken();
    return writeSettings(settings);
}

function regenerateToken() {
    const settings = readSettings();
    settings.token = generateToken();
    const saved = writeSettings(settings);
    return saved;
}

function timingSafeEqual(a, b) {
    const left = Buffer.from(String(a || ''));
    const right = Buffer.from(String(b || ''));
    if (left.length !== right.length || left.length === 0) return false;
    return crypto.timingSafeEqual(left, right);
}

function extractToken(req, url) {
    const header = req.headers['authorization'];
    if (typeof header === 'string' && header.toLowerCase().startsWith('bearer ')) {
        return header.slice(7).trim();
    }
    const queryToken = url.searchParams.get('token');
    return queryToken ? queryToken.trim() : '';
}

function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];

        req.on('data', (chunk) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('Request body is too large.'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function openTerminalInUi(host) {
    const getMainWindow = contextRef.getMainWindow;
    const window = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (!window || window.isDestroyed()) return false;

    try {
        window.webContents.send('mcp:open-terminal', host);
        return true;
    } catch (err) {
        console.error('Failed to ask the UI for a terminal tab:', err);
        return false;
    }
}

// A fresh McpServer per request keeps the endpoint stateless, which is the
// simplest thing that works with every current client.
async function handleMcpRequest(req, res, body) {
    const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
    const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');

    const server = new McpServer(SERVER_INFO, {
        capabilities: { tools: {} },
        instructions: 'Termix exposes the servers saved in the app. Use list_hosts first, run_command for one-off commands, and open_session/send_input/read_output when a command needs an interactive shell.'
    });

    registerTools(server, { openTerminalInUi });

    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true
    });

    res.on('close', () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
}

function createRequestHandler() {
    return async (req, res) => {
        let url;
        try {
            url = new URL(req.url, `http://${HOST}`);
        } catch (_) {
            sendJson(res, 400, { error: 'Bad request' });
            return;
        }

        if (url.pathname === '/health' && req.method === 'GET') {
            sendJson(res, 200, { status: 'ok', server: SERVER_INFO });
            return;
        }

        if (url.pathname !== MCP_PATH) {
            sendJson(res, 404, { error: 'Not found' });
            return;
        }

        const settings = readSettings();
        if (!timingSafeEqual(extractToken(req, url), settings.token)) {
            sendJson(res, 401, { error: 'Invalid or missing MCP token.' });
            return;
        }

        let parsedBody;
        if (req.method === 'POST') {
            try {
                const raw = await readBody(req);
                parsedBody = raw ? JSON.parse(raw) : undefined;
            } catch (err) {
                sendJson(res, 400, { error: `Invalid request body: ${err.message}` });
                return;
            }
        }

        try {
            await handleMcpRequest(req, res, parsedBody);
        } catch (err) {
            console.error('MCP request failed:', err);
            if (!res.headersSent) {
                sendJson(res, 500, { error: err && err.message ? err.message : 'MCP request failed.' });
            }
        }
    };
}

function stop() {
    return new Promise((resolve) => {
        closeSftpSessions().catch(() => {});

        if (!httpServer) {
            runtimeState = { running: false, port: null, error: null, startedAt: null };
            resolve();
            return;
        }

        const server = httpServer;
        httpServer = null;
        runtimeState = { running: false, port: null, error: null, startedAt: null };
        server.close(() => resolve());
    });
}

async function start() {
    await stop();

    const settings = ensureToken();
    if (!settings.enabled) {
        return { ...runtimeState };
    }

    return new Promise((resolve) => {
        const server = http.createServer(createRequestHandler());

        server.once('error', (err) => {
            httpServer = null;
            runtimeState = {
                running: false,
                port: settings.port,
                error: err && err.code === 'EADDRINUSE'
                    ? `Port ${settings.port} is already in use.`
                    : (err && err.message ? err.message : String(err)),
                startedAt: null
            };
            console.error('MCP server failed to start:', runtimeState.error);
            resolve({ ...runtimeState });
        });

        server.listen(settings.port, HOST, () => {
            httpServer = server;
            runtimeState = {
                running: true,
                port: settings.port,
                error: null,
                startedAt: new Date().toISOString()
            };
            console.log(`MCP server listening on http://${HOST}:${settings.port}${MCP_PATH}`);
            resolve({ ...runtimeState });
        });
    });
}

async function restart() {
    return start();
}

function getStatus() {
    const settings = readSettings();
    return {
        ...runtimeState,
        enabled: settings.enabled,
        configuredPort: settings.port,
        url: `http://${HOST}:${settings.port}${MCP_PATH}`,
        hasToken: !!settings.token
    };
}

// The snippet a user pastes into their MCP client configuration.
function getClientConfig() {
    const settings = ensureToken();
    return {
        mcpServers: {
            termix: {
                type: 'http',
                url: `http://${HOST}:${settings.port}${MCP_PATH}`,
                headers: {
                    Authorization: `Bearer ${settings.token}`
                }
            }
        }
    };
}

function init(context = {}) {
    contextRef = context;
    return start();
}

module.exports = {
    init,
    start,
    stop,
    restart,
    getStatus,
    getClientConfig,
    readSettings,
    writeSettings,
    regenerateToken,
    ensureToken
};
