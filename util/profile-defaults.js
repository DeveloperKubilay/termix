const DEFAULT_AI_SETTINGS = {
    method: 'GET',
    url: '',
    body: {},
    headers: {}
};

const DEFAULT_TERMINAL_SETTINGS = {
    cursorBlink: true,
    fontFamily: '"JetBrains Mono", monospace',
    rightClickCopyPaste: true,
    fontSize: 14,
    fontWeight: 500,
    letterSpacing: 0,
    lineHeight: 1.2,
    scrollback: 5000,
    theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#cccccc',
        selectionBackground: '#797979',
        black: '#000000',
        red: '#c50f1f',
        green: '#1d8e48',
        yellow: '#c19c00',
        blue: '#0020c7',
        magenta: '#881798',
        cyan: '#3a96dd',
        white: '#cccccc',
        brightBlack: '#767676',
        brightRed: '#e74856',
        brightGreen: '#16c60c',
        brightYellow: '#f9f1a5',
        brightBlue: '#3b78ff',
        brightMagenta: '#b4009e',
        brightCyan: '#61d6d6',
        brightWhite: '#f2f2f2'
    }
};

const DEFAULT_UPDATE_SETTINGS = {
    autoUpdateEnabled: true,
    lastCheckedAt: null
};

const DEFAULT_SFTP_SETTINGS = {
    confirmOverwriteOnConflict: true,
    // Folders like node_modules are rarely worth sending over the wire, but
    // silently dropping files is worse, so this stays off until asked for.
    skipPatternsEnabled: false,
    skipPatterns: [
        'node_modules',
        '.git',
        '.cache',
        '.next',
        '.nuxt',
        'dist',
        'build',
        'vendor',
        '__pycache__',
        '.venv',
        '.DS_Store',
        'coverage',
        '*.log'
    ]
};

const MCP_PORT_MIN = 1024;
const MCP_PORT_MAX = 65535;

const DEFAULT_MCP_SETTINGS = {
    enabled: false,
    port: 8790,
    token: '',
    // Commands matching the block list are refused before they reach a host.
    blockDestructiveCommands: true,
    // Extra user supplied patterns, matched case-insensitively as substrings.
    blockedPatterns: [],
    // Lets an assistant type into terminals the user already has open.
    allowExistingSessions: true
};

const UI_THEMES = ['classic', 'modern'];
const DEFAULT_UI_THEME = 'modern';
const LEGACY_THEME_MAP = {
    ocean: 'modern',
    graphite: 'modern',
    emerald: 'modern',
    sunset: 'modern'
};

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeAiSettings(value) {
    const out = clone(DEFAULT_AI_SETTINGS);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return out;
    }

    const body = value.body && typeof value.body === 'object' && !Array.isArray(value.body)
        ? value.body
        : {};

    const headers = value.headers && typeof value.headers === 'object' && !Array.isArray(value.headers)
        ? value.headers
        : {};

    return {
        ...out,
        ...value,
        body,
        headers
    };
}

function normalizeTerminalSettings(value) {
    const out = clone(DEFAULT_TERMINAL_SETTINGS);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return out;
    }

    const theme = value.theme && typeof value.theme === 'object' && !Array.isArray(value.theme)
        ? value.theme
        : {};

    return {
        ...out,
        ...value,
        theme: {
            ...out.theme,
            ...theme
        }
    };
}

function normalizeUpdateSettings(value) {
    const out = clone(DEFAULT_UPDATE_SETTINGS);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return out;
    }

    if (typeof value.autoUpdateEnabled === 'boolean') {
        out.autoUpdateEnabled = value.autoUpdateEnabled;
    }

    if (typeof value.lastCheckedAt === 'string' && value.lastCheckedAt.trim()) {
        out.lastCheckedAt = value.lastCheckedAt;
    }

    return out;
}

function normalizeSftpSettings(value) {
    const out = clone(DEFAULT_SFTP_SETTINGS);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return out;
    }

    if (typeof value.confirmOverwriteOnConflict === 'boolean') {
        out.confirmOverwriteOnConflict = value.confirmOverwriteOnConflict;
    }

    if (typeof value.skipPatternsEnabled === 'boolean') {
        out.skipPatternsEnabled = value.skipPatternsEnabled;
    }

    if (Array.isArray(value.skipPatterns)) {
        out.skipPatterns = value.skipPatterns
            .map((pattern) => String(pattern || '').trim())
            .filter(Boolean)
            .slice(0, 200);
    }

    return out;
}

function normalizeMcpSettings(value) {
    const out = clone(DEFAULT_MCP_SETTINGS);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return out;
    }

    if (typeof value.enabled === 'boolean') out.enabled = value.enabled;
    if (typeof value.blockDestructiveCommands === 'boolean') {
        out.blockDestructiveCommands = value.blockDestructiveCommands;
    }
    if (typeof value.allowExistingSessions === 'boolean') {
        out.allowExistingSessions = value.allowExistingSessions;
    }

    const port = Number(value.port);
    if (Number.isInteger(port) && port >= MCP_PORT_MIN && port <= MCP_PORT_MAX) {
        out.port = port;
    }

    if (typeof value.token === 'string') out.token = value.token.trim();

    if (Array.isArray(value.blockedPatterns)) {
        out.blockedPatterns = value.blockedPatterns
            .map((pattern) => String(pattern || '').trim())
            .filter(Boolean)
            .slice(0, 200);
    }

    return out;
}

function normalizeUiTheme(value) {
    let normalized = String(value || '').trim().toLowerCase();
    if (LEGACY_THEME_MAP[normalized]) {
        normalized = LEGACY_THEME_MAP[normalized];
    }
    if (UI_THEMES.includes(normalized)) {
        return normalized;
    }
    return DEFAULT_UI_THEME;
}

module.exports = {
    DEFAULT_AI_SETTINGS,
    DEFAULT_TERMINAL_SETTINGS,
    DEFAULT_UPDATE_SETTINGS,
    DEFAULT_SFTP_SETTINGS,
    DEFAULT_MCP_SETTINGS,
    MCP_PORT_MIN,
    MCP_PORT_MAX,
    UI_THEMES,
    DEFAULT_UI_THEME,
    normalizeAiSettings,
    normalizeTerminalSettings,
    normalizeUpdateSettings,
    normalizeSftpSettings,
    normalizeMcpSettings,
    normalizeUiTheme
};
