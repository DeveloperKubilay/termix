// Tracks live terminal sessions and keeps a rolling copy of their output so an
// assistant can read what a terminal is showing without a renderer round trip.
const MAX_BUFFER_BYTES = 256 * 1024;

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

// CSI sequences, OSC strings (BEL or ST terminated) and the two byte escapes.
// Built from char codes so the source file stays plain ASCII.
const ANSI_PATTERN = new RegExp(
    [
        ESC + '\\[[0-9;?]*[ -/]*[@-~]',
        ESC + '\\][^' + BEL + ESC + ']*(?:' + BEL + '|' + ESC + '\\\\)',
        ESC + '[@-Z\\\\-_]'
    ].join('|'),
    'g'
);

const sessions = new Map();

function emulateTerminalBuffer(raw) {
    if (!raw) return '';
    const input = String(raw);
    const lines = [];
    let currentLine = [];
    let cursorCol = 0;

    let i = 0;
    const len = input.length;

    while (i < len) {
        const ch = input[i];

        if (ch === ESC) {
            if (input[i + 1] === '[') {
                let j = i + 2;
                while (j < len && ((input[j] >= '0' && input[j] <= '9') || input[j] === ';' || input[j] === '?' || input[j] === ' ')) {
                    j++;
                }
                const finalChar = input[j];
                const params = input.slice(i + 2, j);
                const num = parseInt(params, 10) || 1;

                if (finalChar === 'K') {
                    if (params === '' || params === '0') {
                        currentLine = currentLine.slice(0, cursorCol);
                    } else if (params === '1') {
                        for (let k = 0; k <= cursorCol && k < currentLine.length; k++) currentLine[k] = ' ';
                    } else if (params === '2') {
                        currentLine = [];
                        cursorCol = 0;
                    }
                } else if (finalChar === 'D') {
                    cursorCol = Math.max(0, cursorCol - num);
                } else if (finalChar === 'C') {
                    cursorCol += num;
                } else if (finalChar === 'G') {
                    cursorCol = Math.max(0, (parseInt(params, 10) || 1) - 1);
                }
                i = j + 1;
                continue;
            }

            if (input[i + 1] === ']') {
                let j = i + 2;
                while (j < len && input[j] !== BEL && !(input[j] === ESC && input[j + 1] === '\\')) {
                    j++;
                }
                i = input[j] === BEL ? j + 1 : (j < len ? j + 2 : len);
                continue;
            }

            i += 2;
            continue;
        }

        if (ch === '\r') {
            if (input[i + 1] === '\n') {
                lines.push(currentLine.join(''));
                currentLine = [];
                cursorCol = 0;
                i += 2;
                continue;
            } else {
                cursorCol = 0;
                i++;
                continue;
            }
        }

        if (ch === '\n') {
            lines.push(currentLine.join(''));
            currentLine = [];
            cursorCol = 0;
            i++;
            continue;
        }

        if (ch === '\b' || ch.charCodeAt(0) === 127 || ch.charCodeAt(0) === 8) {
            cursorCol = Math.max(0, cursorCol - 1);
            i++;
            continue;
        }

        if (ch === '\t') {
            const spaces = 4 - (cursorCol % 4);
            for (let s = 0; s < spaces; s++) {
                currentLine[cursorCol++] = ' ';
            }
            i++;
            continue;
        }

        if (ch.charCodeAt(0) >= 32) {
            currentLine[cursorCol] = ch;
            cursorCol++;
        }
        i++;
    }

    if (currentLine.length > 0 || cursorCol > 0) {
        lines.push(currentLine.join(''));
    }

    return lines.join('\n');
}

function stripAnsi(text) {
    return emulateTerminalBuffer(text);
}

function describeHost(hostInfo = {}) {
    const protocol = String(hostInfo.protocol || 'SSH').toUpperCase();
    return {
        id: hostInfo.id != null ? hostInfo.id : null,
        name: hostInfo.name || hostInfo.address || hostInfo.path || 'Terminal',
        protocol,
        address: hostInfo.address || null,
        username: hostInfo.username || null,
        path: hostInfo.path || null
    };
}

function register(sessionId, hostInfo, origin = 'ui') {
    if (!sessionId) return null;

    const entry = {
        sessionId,
        host: describeHost(hostInfo),
        origin,
        startedAt: Date.now(),
        chunks: [],
        bytes: 0
    };

    sessions.set(sessionId, entry);
    return entry;
}

function appendOutput(sessionId, data) {
    const entry = sessions.get(sessionId);
    if (!entry || !data) return;

    const text = String(data);
    entry.chunks.push(text);
    entry.bytes += text.length;

    while (entry.bytes > MAX_BUFFER_BYTES && entry.chunks.length > 1) {
        entry.bytes -= entry.chunks.shift().length;
    }
}

function remove(sessionId) {
    sessions.delete(sessionId);
}

function get(sessionId) {
    return sessions.get(sessionId) || null;
}

function list() {
    return Array.from(sessions.values()).map((entry) => ({
        sessionId: entry.sessionId,
        host: entry.host,
        origin: entry.origin,
        startedAt: new Date(entry.startedAt).toISOString(),
        bufferedBytes: entry.bytes
    }));
}

// Returns the tail of a session's output, ANSI escapes removed by default.
function readOutput(sessionId, options = {}) {
    const entry = sessions.get(sessionId);
    if (!entry) return null;

    const raw = entry.chunks.join('');
    const text = options.raw ? raw : stripAnsi(raw);
    const requested = Number(options.lines);
    const lineCount = Number.isFinite(requested) && requested > 0
        ? Math.min(Math.round(requested), 2000)
        : 200;

    const lines = text.split('\n');
    const tail = lines.slice(Math.max(0, lines.length - lineCount));

    return {
        sessionId,
        host: entry.host,
        lines: tail.length,
        text: tail.join('\n')
    };
}

function clear() {
    sessions.clear();
}

module.exports = {
    register,
    appendOutput,
    remove,
    get,
    list,
    readOutput,
    stripAnsi,
    clear,
    MAX_BUFFER_BYTES
};
