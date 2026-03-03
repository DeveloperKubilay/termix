const DEFAULT_AI_SETTINGS = {
    method: 'GET',
    url: '',
    body: {},
    headers: {}
};

const DEFAULT_TERMINAL_SETTINGS = {
    cursorBlink: true,
    fontFamily: '"JetBrains Mono", "Fira Code", Consolas, "Courier New", monospace',
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

module.exports = {
    DEFAULT_AI_SETTINGS,
    DEFAULT_TERMINAL_SETTINGS,
    DEFAULT_UPDATE_SETTINGS,
    normalizeAiSettings,
    normalizeTerminalSettings,
    normalizeUpdateSettings
};
