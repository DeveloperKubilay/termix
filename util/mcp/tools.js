// Tool surface exposed over MCP: hosts, one-shot commands, live terminal
// sessions and remote files.
const { z } = require('zod');

const db = require('../profile-db');
const { decrypt } = require('../crypto');
const { normalizeMcpSettings } = require('../profile-defaults');
const sshExec = require('../connections/ssh-exec');
const newConnection = require('../terminal/newconnection');
const sftpManager = require('../sftp/manager');
const sessionStore = require('./session-store');
const { inspectCommand } = require('./guard');
const http = require('http');

const MAX_FILE_BYTES = 512 * 1024;

function queryTermixGui(endpoint, method = 'GET', body = null) {
    return new Promise((resolve) => {
        const payload = body ? JSON.stringify(body) : null;
        const options = {
            hostname: '127.0.0.1',
            port: 8790,
            path: endpoint,
            method,
            timeout: 1500,
            headers: payload ? {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload)
            } : {}
        };

        const req = http.request(options, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    resolve(parsed);
                } catch (_) {
                    resolve(null);
                }
            });
        });

        req.on('error', () => resolve(null));
        req.on('timeout', () => { req.destroy(); resolve(null); });
        if (payload) req.write(payload);
        req.end();
    });
}

// SFTP sessions opened on behalf of MCP, keyed by host id.
const sftpSessions = new Map();

function getSettings() {
    return normalizeMcpSettings(db.get('mcp'));
}

function readHosts() {
    const raw = db.get('hosts');
    const data = Array.isArray(raw) ? raw : [];
    return data.map((item) => {
        const next = item && typeof item === 'object' ? { ...item } : {};
        if (next.password) {
            try {
                next.password = decrypt(next.password);
            } catch (_) {
                next.password = '';
            }
        }
        return next;
    });
}

// Everything an assistant is allowed to see about a host: no secrets.
function publicHost(host) {
    return {
        id: host.id != null ? host.id : null,
        name: host.name || host.address || 'Unnamed host',
        protocol: String(host.protocol || 'SSH').toUpperCase(),
        address: host.address || null,
        port: host.port != null ? host.port : null,
        username: host.username || null,
        path: host.path || null,
        tags: Array.isArray(host.tags) ? host.tags : [],
        authType: host.certPath ? 'key' : (host.password ? 'password' : 'none')
    };
}

function resolveHost(identifier) {
    const needle = String(identifier == null ? '' : identifier).trim();
    if (!needle) throw new Error('A host id or name is required.');

    const hosts = readHosts();
    const lowered = needle.toLowerCase();

    const byId = hosts.find(h => String(h.id) === needle);
    if (byId) return byId;

    const byName = hosts.find(h => String(h.name || '').toLowerCase() === lowered);
    if (byName) return byName;

    const byAddress = hosts.find(h => {
        const address = String(h.address || '').toLowerCase();
        const combined = `${String(h.username || '').toLowerCase()}@${address}`;
        return address === lowered || combined === lowered;
    });
    if (byAddress) return byAddress;

    throw new Error(`No host matches "${needle}". Use list_hosts to see what is available.`);
}

function requireSsh(host) {
    const protocol = String(host.protocol || 'SSH').toUpperCase();
    if (protocol !== 'SSH' && protocol !== 'SFTP') {
        throw new Error(`Host "${host.name}" uses ${protocol}; only SSH hosts accept remote commands.`);
    }
}

function jsonResult(payload) {
    return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }]
    };
}

function textResult(text) {
    return { content: [{ type: 'text', text: String(text) }] };
}

function errorResult(message) {
    return {
        isError: true,
        content: [{ type: 'text', text: String(message) }]
    };
}

// Wraps a handler so a thrown error becomes a tool error instead of a
// transport level failure.
function safe(handler) {
    return async (args, extra) => {
        try {
            return await handler(args || {}, extra);
        } catch (err) {
            return errorResult(err && err.message ? err.message : String(err));
        }
    };
}

async function getSftpSession(host) {
    const cached = sftpSessions.get(String(host.id));
    if (cached) return cached;

    const result = await sftpManager.connect(host.id);
    if (!result || !result.success) {
        throw new Error((result && result.message) || 'SFTP connection failed.');
    }

    sftpSessions.set(String(host.id), result.sessionId);
    return result.sessionId;
}

function forgetSftpSession(host) {
    sftpSessions.delete(String(host.id));
}

// Retries once on a stale cached session, which is the common failure after an
// idle connection has been dropped by the server.
async function withSftp(host, action) {
    let sessionId = await getSftpSession(host);
    let result = await action(sessionId);

    if (result && result.success === false) {
        forgetSftpSession(host);
        sessionId = await getSftpSession(host);
        result = await action(sessionId);
    }

    if (!result || result.success === false) {
        throw new Error((result && result.message) || 'SFTP request failed.');
    }

    return result;
}

async function closeSftpSessions() {
    const ids = Array.from(sftpSessions.values());
    sftpSessions.clear();
    await Promise.all(ids.map(id => sftpManager.disconnect(id).catch(() => {})));
}

function registerTools(server, context = {}) {
    const openTerminalInUi = typeof context.openTerminalInUi === 'function'
        ? context.openTerminalInUi
        : null;

    /* ------------------------------------------------------------ hosts */

    server.registerTool('list_hosts', {
        title: 'List saved hosts',
        description: 'Lists all saved SSH/SFTP servers in Termix. Always call this tool first to discover available host IDs, names, tags, usernames, and addresses before running commands or opening sessions.',
        inputSchema: {
            query: z.string().optional().describe('Filter on name, address or username'),
            tag: z.string().optional().describe('Only hosts carrying this tag')
        }
    }, safe(async ({ query, tag }) => {
        let hosts = readHosts().map(publicHost);

        if (query) {
            const needle = String(query).toLowerCase();
            hosts = hosts.filter(h =>
                String(h.name || '').toLowerCase().includes(needle) ||
                String(h.address || '').toLowerCase().includes(needle) ||
                String(h.username || '').toLowerCase().includes(needle));
        }

        if (tag) {
            const needle = String(tag).toLowerCase();
            hosts = hosts.filter(h => h.tags.some(t => String(t).toLowerCase() === needle));
        }

        return jsonResult({ count: hosts.length, hosts });
    }));

    /* --------------------------------------------------------- commands */

    server.registerTool('run_command', {
        title: 'Run a shell command',
        description: 'Executes a non-interactive shell command on a host over SSH using Termix high-speed pooled connection and returns stdout, stderr, and the exit code. Use this for quick checks, builds, scripts, running bash commands, git commands, etc.',
        inputSchema: {
            host: z.string().describe('Host id, name or user@address (from list_hosts)'),
            command: z.string().describe('Shell command to run on the remote host'),
            timeoutMs: z.number().int().positive().optional().describe('Timeout in milliseconds (default 30000)')
        }
    }, safe(async ({ host, command, timeoutMs }) => {
        const settings = getSettings();
        const verdict = inspectCommand(command, settings);
        if (!verdict.allowed) {
            return errorResult(`Refused by Termix command guard: ${verdict.reason}. Adjust the block list in Settings > MCP if this was intended.`);
        }

        const target = resolveHost(host);
        requireSsh(target);

        const result = await sshExec.runCommand(target, command, { timeoutMs });
        return jsonResult({
            host: publicHost(target),
            command,
            exitCode: result.exitCode,
            signal: result.signal,
            timedOut: result.timedOut,
            truncated: result.truncated,
            stdout: result.stdout,
            stderr: result.stderr
        });
    }));

    /* --------------------------------------------------------- sessions */

    server.registerTool('list_sessions', {
        title: 'List terminal sessions',
        description: 'Lists all currently open terminal sessions and live tabs (both in the Termix GUI window and headless MCP sessions). Returns sessionId, host info, and buffer sizes.',
        inputSchema: {}
    }, safe(async () => {
        let sessions = sessionStore.list();
        const remote = await queryTermixGui('/api/sessions', 'GET');
        if (remote && Array.isArray(remote.sessions)) {
            const localIds = new Set(sessions.map(s => s.sessionId));
            for (const remSession of remote.sessions) {
                if (!localIds.has(remSession.sessionId)) {
                    sessions.push(remSession);
                }
            }
        }
        return jsonResult({ count: sessions.length, sessions });
    }));

    server.registerTool('open_session', {
        title: 'Open a headless shell session',
        description: 'Opens a persistent background PTY shell on a host. This session is headless (not shown as a tab in Termix GUI). Use send_input to type and read_output to read responses. If you want to open a visible tab for the user, use open_terminal_tab instead.',
        inputSchema: {
            host: z.string().describe('Host id, name or user@address (from list_hosts)')
        }
    }, safe(async ({ host }) => {
        const target = resolveHost(host);
        requireSsh(target);

        const connection = await newConnection({ ...target, initialCols: 120, initialRows: 40 });
        if (!global.Terminals) global.Terminals = {};
        global.Terminals[connection.sessionId] = connection;

        sessionStore.register(connection.sessionId, target, 'mcp');
        connection.on('data', (msg) => {
            if (msg.type === 'data') {
                sessionStore.appendOutput(connection.sessionId, msg.data);
            } else if (msg.type === 'disconnected') {
                sessionStore.remove(connection.sessionId);
                delete global.Terminals[connection.sessionId];
            }
        });

        return jsonResult({
            sessionId: connection.sessionId,
            host: publicHost(target),
            note: 'Give the shell a moment before calling read_output.'
        });
    }));

    server.registerTool('send_input', {
        title: 'Type into an active terminal session',
        description: 'Sends keystrokes or commands into an active terminal session (either a visible GUI tab or a headless session). Useful for interactive prompts (sudo password, y/n questions, top, nano). Appends a newline by default.',
        inputSchema: {
            sessionId: z.string().describe('Session id (from list_sessions or open_session)'),
            input: z.string().describe('Text or command to type into the terminal'),
            submit: z.boolean().optional().describe('Append Enter/newline (default true)')
        }
    }, safe(async ({ sessionId, input, submit }) => {
        const settings = getSettings();
        const verdict = inspectCommand(input, settings);
        if (!verdict.allowed) {
            return errorResult(`Refused by Termix command guard: ${verdict.reason}.`);
        }

        const entry = sessionStore.get(sessionId);
        const session = global.Terminals && global.Terminals[sessionId];
        if (session) {
            if (entry && entry.origin === 'ui' && settings.allowExistingSessions === false) {
                return errorResult('Typing into terminals opened by the user is disabled in Settings > MCP.');
            }
            const payload = submit === false ? String(input) : `${input}\n`;
            session.write({ type: 'input', message: payload });
            return textResult(`Sent ${payload.length} characters.`);
        }

        const remote = await queryTermixGui('/api/send-input', 'POST', { sessionId, input, submit });
        if (remote && remote.success) {
            return textResult(`Sent ${input.length} characters to Termix GUI session.`);
        }

        return errorResult(`Session ${sessionId} is not connected.`);
    }));

    server.registerTool('read_output', {
        title: 'Read terminal output and screen content',
        description: 'Returns recent output and screen text from an active terminal session (including live tabs opened by the user in Termix). Strips ANSI color escapes by default for clean reading.',
        inputSchema: {
            sessionId: z.string().describe('Session id (from list_sessions)'),
            lines: z.number().int().positive().optional().describe('Number of trailing lines to read (default 200)'),
            raw: z.boolean().optional().describe('Keep raw ANSI escape sequences (default false)')
        }
    }, safe(async ({ sessionId, lines, raw }) => {
        let output = sessionStore.readOutput(sessionId, { lines, raw });
        if (!output) {
            const remote = await queryTermixGui('/api/read-output', 'POST', { sessionId, lines, raw });
            if (remote && remote.output) {
                output = remote.output;
            }
        }
        if (!output) return errorResult(`No live session with id ${sessionId}.`);
        return jsonResult(output);
    }));

    server.registerTool('close_session', {
        title: 'Close a terminal session',
        description: 'Closes an active terminal session. Closes the underlying SSH channel.',
        inputSchema: {
            sessionId: z.string().describe('Session id to close')
        }
    }, safe(async ({ sessionId }) => {
        const session = global.Terminals && global.Terminals[sessionId];
        if (session) {
            try { session.end(); } catch (_) {}
            delete global.Terminals[sessionId];
            sessionStore.remove(sessionId);
            return textResult(`Closed session ${sessionId}.`);
        }

        const remote = await queryTermixGui('/api/close-session', 'POST', { sessionId });
        if (remote && remote.success) {
            return textResult(`Closed session ${sessionId} in Termix GUI.`);
        }

        return textResult(`Session ${sessionId} was already gone.`);
    }));

    if (openTerminalInUi) {
        server.registerTool('open_terminal_tab', {
            title: 'Open a visible terminal tab in Termix GUI',
            description: 'Opens a visible, interactive terminal tab for a host directly in the Termix app window on the user screen. ALWAYS call this tool when the user asks to connect to a host or open a terminal in Termix.',
            inputSchema: {
                host: z.string().describe('Host id, name or user@address (from list_hosts)')
            }
        }, safe(async ({ host }) => {
            const target = resolveHost(host);
            const delivered = openTerminalInUi(publicHost(target));
            if (!delivered) {
                return errorResult('The Termix window is not available right now. The command can still be run with run_command or open_session.');
            }
            return textResult(`Opened a visible terminal tab for ${target.name} in Termix. Call list_sessions in a moment to get its session id.`);
        }));
    }

    /* ------------------------------------------------------------ files */

    server.registerTool('list_directory', {
        title: 'List remote directory via SFTP',
        description: 'Lists files and folders inside a remote directory on a host over SFTP.',
        inputSchema: {
            host: z.string().describe('Host id, name or user@address (from list_hosts)'),
            path: z.string().optional().describe('Absolute path to list (default: user home directory)')
        }
    }, safe(async ({ host, path: targetPath }) => {
        const target = resolveHost(host);
        requireSsh(target);

        const result = await withSftp(target, (sessionId) => sftpManager.listDirectory({
            side: 'remote',
            sessionId,
            path: targetPath || ''
        }));

        const entries = Array.isArray(result.items) ? result.items : (result.entries || []);
        return jsonResult({ path: result.path || targetPath || '', count: entries.length, entries });
    }));

    server.registerTool('read_file', {
        title: 'Read remote file via SFTP',
        description: 'Reads the text content of a remote file (config, log, script, etc.) on a host over SFTP.',
        inputSchema: {
            host: z.string().describe('Host id, name or user@address (from list_hosts)'),
            path: z.string().describe('Absolute path of the remote file to read'),
            maxBytes: z.number().int().positive().optional().describe('Maximum bytes to read (default 512KB)')
        }
    }, safe(async ({ host, path: targetPath, maxBytes }) => {
        const target = resolveHost(host);
        requireSsh(target);

        const limit = Math.min(Number(maxBytes) || MAX_FILE_BYTES, MAX_FILE_BYTES);
        const result = await withSftp(target, (sessionId) => sftpManager.readFile({
            side: 'remote',
            sessionId,
            path: targetPath,
            maxBytes: limit
        }));

        return jsonResult({
            path: targetPath,
            truncated: !!result.truncated,
            content: result.content != null ? result.content : ''
        });
    }));

    server.registerTool('write_file', {
        title: 'Write remote file via SFTP',
        description: 'Creates or updates a remote text file on a host over SFTP, replacing its contents.',
        inputSchema: {
            host: z.string().describe('Host id, name or user@address (from list_hosts)'),
            path: z.string().describe('Absolute path of the remote file to write'),
            content: z.string().describe('New content to write into the file')
        }
    }, safe(async ({ host, path: targetPath, content }) => {
        const target = resolveHost(host);
        requireSsh(target);

        await withSftp(target, (sessionId) => sftpManager.writeFile({
            side: 'remote',
            sessionId,
            path: targetPath,
            content: String(content == null ? '' : content)
        }));

        return textResult(`Wrote ${String(content || '').length} characters to ${targetPath} on ${target.name}.`);
    }));

    /* --------------------------------------------------------- snippets */

    server.registerTool('list_snippets', {
        title: 'List saved snippets',
        description: 'Lists all reusable command snippets saved by the user in Termix.',
        inputSchema: {}
    }, safe(async () => {
        const raw = db.get('snippets');
        const snippets = (Array.isArray(raw) ? raw : []).map(item => ({
            id: item && item.id != null ? item.id : null,
            name: (item && item.name) || 'Untitled',
            command: (item && item.command) || ''
        }));
        return jsonResult({ count: snippets.length, snippets });
    }));
}

module.exports = {
    registerTools,
    closeSftpSessions,
    resolveHost,
    publicHost,
    readHosts
};
