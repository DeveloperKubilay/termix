const db = require('../../util/profile-db');
const { normalizeAiSettings } = require('../../util/profile-defaults');

const REQUEST_TIMEOUT_MS = 45000;

function toText(value) {
    return String(value == null ? '' : value).trim();
}

function isObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value, fallback) {
    try {
        return JSON.parse(JSON.stringify(value));
    } catch (_) {
        return fallback;
    }
}

function applyPromptPlaceholders(value, prompt) {
    if (typeof value === 'string') {
        return value.replace(/\{\{\s*(prompt|message)\s*\}\}/gi, prompt);
    }

    if (Array.isArray(value)) {
        return value.map((item) => applyPromptPlaceholders(item, prompt));
    }

    if (isObject(value)) {
        const out = {};
        for (const [key, item] of Object.entries(value)) {
            out[key] = applyPromptPlaceholders(item, prompt);
        }
        return out;
    }

    return value;
}

function normalizeHeaders(headers) {
    const out = {};
    if (!isObject(headers)) return out;

    for (const [rawKey, rawValue] of Object.entries(headers)) {
        const key = toText(rawKey);
        if (!key) continue;
        out[key] = String(rawValue == null ? '' : rawValue);
    }

    return out;
}

function normalizeConversationMessages(messages) {
    if (!Array.isArray(messages)) return [];

    const out = [];
    for (const item of messages) {
        if (!isObject(item)) continue;

        const role = toText(item.role).toLowerCase();
        if (!role) continue;
        if (!['system', 'user', 'assistant'].includes(role)) continue;

        const content = toText(item.content);
        if (!content) continue;

        out.push({ role, content });
    }

    return out;
}

function getLastUserPrompt(messages) {
    if (!Array.isArray(messages)) return '';

    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const item = messages[i];
        if (item && item.role === 'user' && toText(item.content)) {
            return toText(item.content);
        }
    }

    return '';
}

function buildGeneratePromptFromMessages(messages, fallbackPrompt) {
    const normalized = normalizeConversationMessages(messages);
    if (!normalized.length) {
        return fallbackPrompt;
    }

    const lines = [
        'Conversation history:',
        ...normalized.map((item) => {
            const role = item.role === 'assistant'
                ? 'Assistant'
                : item.role === 'system'
                    ? 'System'
                    : 'User';
            return `${role}: ${item.content}`;
        }),
        'Assistant:'
    ];

    return lines.join('\n');
}

function parseJsonLines(raw) {
    if (!raw || typeof raw !== 'string') return null;

    const lines = raw
        .split(/\r?\n/g)
        .map((line) => line.trim())
        .filter(Boolean);

    if (!lines.length) return null;

    const parsed = [];
    for (const line of lines) {
        try {
            parsed.push(JSON.parse(line));
        } catch (_) {
            return null;
        }
    }

    if (!parsed.length) return null;
    if (parsed.length === 1) return parsed[0];
    return parsed;
}

function readJson(raw) {
    if (!raw || typeof raw !== 'string') return null;
    try {
        return JSON.parse(raw);
    } catch (_) {
        return parseJsonLines(raw);
    }
}

function extractMessageText(payload) {
    if (payload == null) return '';

    if (typeof payload === 'string') {
        return payload;
    }

    if (Array.isArray(payload)) {
        return payload
            .map((item) => extractMessageText(item))
            .filter(Boolean)
            .join('');
    }

    if (isObject(payload.message) && typeof payload.message.content === 'string') {
        return payload.message.content;
    }

    if (typeof payload.response === 'string') {
        return payload.response;
    }

    if (Array.isArray(payload.choices) && payload.choices.length > 0) {
        const firstChoice = payload.choices[0];
        if (isObject(firstChoice.message) && typeof firstChoice.message.content === 'string') {
            return firstChoice.message.content;
        }
        if (typeof firstChoice.text === 'string') {
            return firstChoice.text;
        }
    }

    if (typeof payload.output_text === 'string') {
        return payload.output_text;
    }

    return '';
}

function buildRequestBody(baseBody, prompt, endpointPath, conversationMessages) {
    const body = applyPromptPlaceholders(cloneJson(baseBody, {}), prompt);
    const path = String(endpointPath || '').toLowerCase();
    const normalizedMessages = normalizeConversationMessages(conversationMessages);

    const isGenerateEndpoint = path.includes('/api/generate');
    const isChatEndpoint = path.includes('/api/chat') || path.includes('/v1/chat/completions');

    if (isGenerateEndpoint) {
        body.prompt = buildGeneratePromptFromMessages(normalizedMessages, prompt);
        if (Object.prototype.hasOwnProperty.call(body, 'stream')) {
            body.stream = Boolean(body.stream);
        }
        return body;
    }

    const baseMessages = Array.isArray(body.messages)
        ? normalizeConversationMessages(body.messages)
        : [];
    const hasMessagesArray = baseMessages.length > 0;

    if (isChatEndpoint || hasMessagesArray) {
        const messages = normalizedMessages.length > 0
            ? [...baseMessages, ...normalizedMessages]
            : [...baseMessages, { role: 'user', content: prompt }];
        body.messages = messages;
        if (Object.prototype.hasOwnProperty.call(body, 'stream')) {
            body.stream = Boolean(body.stream);
        }
        return body;
    }

    body.prompt = prompt;
    return body;
}

function getErrorMessage(parsedPayload, fallbackText, statusCode) {
    if (isObject(parsedPayload.error) && typeof parsedPayload.error.message === 'string') {
        return parsedPayload.error.message;
    }

    if (typeof parsedPayload.error === 'string') {
        return parsedPayload.error;
    }

    if (typeof parsedPayload.message === 'string') {
        return parsedPayload.message;
    }

    const fallback = toText(fallbackText);
    if (fallback) return fallback;
    return `AI request failed (${statusCode})`;
}

module.exports = async function (filesPath, payload = {}) {
    try {
        const conversationMessages = normalizeConversationMessages(payload.messages);
        const prompt = toText(payload.prompt || getLastUserPrompt(conversationMessages));
        if (!prompt && conversationMessages.length === 0) {
            return { success: false, message: 'Message cannot be empty.' };
        }

        const ai = normalizeAiSettings(db.get('ai'));
        const requestedMethod = toText(ai.method || 'POST').toUpperCase() || 'POST';
        const urlRaw = toText(ai.url);

        if (!urlRaw) {
            return {
                success: false,
                message: 'AI endpoint is not configured. Set URL in Settings > AI Integration.'
            };
        }

        let endpoint;
        try {
            endpoint = new URL(urlRaw);
        } catch (_) {
            return { success: false, message: 'AI endpoint URL is invalid.' };
        }

        if (!['http:', 'https:'].includes(endpoint.protocol)) {
            return { success: false, message: 'AI endpoint must start with http:// or https://.' };
        }

        const endpointPath = endpoint.pathname.toLowerCase();
        const requiresPost = endpointPath.includes('/api/generate')
            || endpointPath.includes('/api/chat')
            || endpointPath.includes('/v1/chat/completions');
        const method = requiresPost && (requestedMethod === 'GET' || requestedMethod === 'HEAD')
            ? 'POST'
            : requestedMethod;

        const headers = normalizeHeaders(ai.headers);
        let requestBody;

        if (method !== 'GET' && method !== 'HEAD') {
            requestBody = buildRequestBody(ai.body, prompt, endpointPath, conversationMessages);
            if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
                headers['Content-Type'] = 'application/json';
            }
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        let response;
        try {
            response = await fetch(endpoint.toString(), {
                method,
                headers,
                body: requestBody ? JSON.stringify(requestBody) : undefined,
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }

        const rawText = await response.text();
        const parsed = readJson(rawText);

        if (!response.ok) {
            return {
                success: false,
                message: getErrorMessage(parsed, rawText, response.status),
                status: response.status,
                raw: parsed || rawText
            };
        }

        const reply = toText(extractMessageText(parsed));
        if (!reply) {
            return {
                success: false,
                message: 'AI response is empty or unsupported.',
                status: response.status,
                raw: parsed || rawText
            };
        }

        return {
            success: true,
            reply,
            status: response.status,
            raw: parsed || rawText
        };
    } catch (err) {
        if (err && err.name === 'AbortError') {
            return { success: false, message: 'AI request timed out.' };
        }

        return {
            success: false,
            message: err && err.message ? err.message : String(err)
        };
    }
};
