const REQUEST_PROVIDER = Object.freeze({
    GENERIC: 'generic',
    OLLAMA: 'ollama',
    OPENAI: 'openai',
    ANTHROPIC: 'anthropic',
    GEMINI: 'gemini'
});

function toText(value) {
    return String(value == null ? '' : value).trim();
}

function toRawText(value) {
    return String(value == null ? '' : value);
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

function extractInlineText(value) {
    if (typeof value === 'string') {
        return value;
    }

    if (Array.isArray(value)) {
        return value
            .map((item) => extractInlineText(item))
            .filter(Boolean)
            .join('');
    }

    if (!value || typeof value !== 'object') {
        return '';
    }

    if (typeof value.text === 'string') {
        return value.text;
    }

    if (typeof value.content === 'string') {
        return value.content;
    }

    if (Array.isArray(value.content)) {
        return extractInlineText(value.content);
    }

    if (value.delta && typeof value.delta.text === 'string') {
        return value.delta.text;
    }

    if (value.part && typeof value.part.text === 'string') {
        return value.part.text;
    }

    if (value.message && typeof value.message.content === 'string') {
        return value.message.content;
    }

    return '';
}

function normalizeConversationMessages(messages) {
    if (!Array.isArray(messages)) return [];

    const out = [];
    for (const item of messages) {
        if (!isObject(item)) continue;

        const role = toText(item.role).toLowerCase();
        if (!role) continue;
        if (!['system', 'user', 'assistant', 'developer', 'model'].includes(role)) continue;

        const normalizedRole = role === 'developer'
            ? 'system'
            : role === 'model'
                ? 'assistant'
                : role;
        const content = toText(extractInlineText(item.content));
        if (!content) continue;

        out.push({ role: normalizedRole, content });
    }

    return out;
}

function normalizeOpenAiResponseInput(input) {
    if (typeof input === 'string') {
        const text = toText(input);
        return text ? [{ role: 'user', content: text }] : [];
    }

    if (!Array.isArray(input)) {
        return [];
    }

    const out = [];
    for (const item of input) {
        if (!isObject(item)) continue;

        const role = toText(item.role).toLowerCase();
        const content = toText(extractInlineText(item.content));
        if (!role || !content) continue;

        out.push({
            role: role === 'developer' ? 'system' : role,
            content
        });
    }

    return normalizeConversationMessages(out);
}

function normalizeGeminiContents(contents) {
    if (!Array.isArray(contents)) return [];

    const out = [];
    for (const item of contents) {
        if (!isObject(item)) continue;

        const role = toText(item.role).toLowerCase();
        const normalizedRole = role === 'model' ? 'assistant' : role || 'user';
        const content = toText(extractInlineText(item.parts));
        if (!content) continue;

        out.push({
            role: normalizedRole === 'assistant' ? 'assistant' : 'user',
            content
        });
    }

    return normalizeConversationMessages(out);
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

function splitSystemMessages(messages) {
    const system = [];
    const conversation = [];

    for (const item of normalizeConversationMessages(messages)) {
        if (item.role === 'system') {
            system.push(item.content);
            continue;
        }
        conversation.push(item);
    }

    return {
        systemText: system.join('\n\n').trim(),
        conversation
    };
}

function mergeConversation(baseMessages, runtimeMessages, fallbackPrompt) {
    const base = normalizeConversationMessages(baseMessages);
    const runtime = normalizeConversationMessages(runtimeMessages);
    const nextRuntime = runtime.length
        ? [...runtime]
        : (toText(fallbackPrompt) ? [{ role: 'user', content: toText(fallbackPrompt) }] : []);

    while (
        base.length > 0
        && nextRuntime.length > 0
        && base[base.length - 1].role === nextRuntime[0].role
        && base[base.length - 1].content === nextRuntime[0].content
    ) {
        nextRuntime.shift();
    }

    return [...base, ...nextRuntime];
}

function getHeader(headers, key) {
    const target = String(key || '').toLowerCase();
    return Object.entries(headers || {}).find(([name]) => name.toLowerCase() === target) || null;
}

function setHeaderIfMissing(headers, key, value) {
    if (!getHeader(headers, key)) {
        headers[key] = value;
    }
}

function hostMatches(hostname, expected) {
    const host = toText(hostname).toLowerCase();
    return host === expected || host.endsWith(`.${expected}`);
}

function detectProviderFromUrl(endpoint) {
    const host = toText(endpoint.hostname).toLowerCase();
    const path = toText(endpoint.pathname).toLowerCase();

    if (path.includes('/api/generate')) {
        return {
            provider: REQUEST_PROVIDER.OLLAMA,
            flavor: 'ollama-generate',
            streamTransport: 'ndjson'
        };
    }

    if (path.includes('/api/chat')) {
        return {
            provider: REQUEST_PROVIDER.OLLAMA,
            flavor: 'ollama-chat',
            streamTransport: 'ndjson'
        };
    }

    if (path.includes('/v1/chat/completions')) {
        return {
            provider: REQUEST_PROVIDER.OPENAI,
            flavor: 'openai-chat',
            streamTransport: 'sse'
        };
    }

    if (path.includes('/v1/responses')) {
        return {
            provider: REQUEST_PROVIDER.OPENAI,
            flavor: 'openai-responses',
            streamTransport: 'sse'
        };
    }

    if (path.includes('/v1/messages') || hostMatches(host, 'api.anthropic.com')) {
        return {
            provider: REQUEST_PROVIDER.ANTHROPIC,
            flavor: 'anthropic-messages',
            streamTransport: 'sse'
        };
    }

    if (
        path.includes(':streamgeneratecontent')
        || path.includes(':generatecontent')
        || hostMatches(host, 'generativelanguage.googleapis.com')
    ) {
        return {
            provider: REQUEST_PROVIDER.GEMINI,
            flavor: path.includes(':streamgeneratecontent') ? 'gemini-stream' : 'gemini-generate',
            streamTransport: 'sse'
        };
    }

    return {
        provider: REQUEST_PROVIDER.GENERIC,
        flavor: 'generic',
        streamTransport: 'unknown'
    };
}

function combineText(a, b) {
    const left = toText(a);
    const right = toText(b);
    if (!left) return right;
    if (!right) return left;
    return `${left}\n\n${right}`;
}

function toOpenAiInputMessages(messages) {
    return normalizeConversationMessages(messages).map((item) => ({
        type: 'message',
        role: item.role,
        content: [
            {
                type: 'input_text',
                text: item.content
            }
        ]
    }));
}

function normalizeProviderBody(providerInfo, baseBody, prompt, runtimeMessages) {
    const body = applyPromptPlaceholders(cloneJson(baseBody, {}), prompt);
    const provider = providerInfo.provider;
    const flavor = providerInfo.flavor;
    const explicitStream = typeof body.stream === 'boolean' ? body.stream : null;
    let streamRequested = explicitStream === true || flavor === 'gemini-stream';

    if (provider === REQUEST_PROVIDER.OLLAMA && flavor === 'ollama-generate') {
        const generatedPrompt = buildGeneratePromptFromMessages(runtimeMessages, prompt);
        const seedPrompt = toText(body.prompt);
        body.prompt = seedPrompt && seedPrompt !== prompt
            ? combineText(seedPrompt, generatedPrompt)
            : generatedPrompt;
        delete body.messages;
        delete body.input;
        delete body.contents;
        if (explicitStream !== null) {
            body.stream = explicitStream;
            streamRequested = explicitStream;
        }
        return { body, streamRequested };
    }

    if (provider === REQUEST_PROVIDER.OLLAMA || (provider === REQUEST_PROVIDER.OPENAI && flavor === 'openai-chat')) {
        const mergedMessages = mergeConversation(body.messages, runtimeMessages, prompt);
        body.messages = mergedMessages;
        delete body.prompt;
        delete body.input;
        delete body.contents;
        if (explicitStream !== null) {
            body.stream = explicitStream;
            streamRequested = explicitStream;
        }
        return { body, streamRequested };
    }

    if (provider === REQUEST_PROVIDER.OPENAI && flavor === 'openai-responses') {
        const seedMessages = normalizeOpenAiResponseInput(body.input);
        const mergedMessages = mergeConversation(seedMessages, runtimeMessages, prompt);
        body.input = toOpenAiInputMessages(mergedMessages);
        delete body.prompt;
        delete body.messages;
        delete body.contents;
        if (explicitStream !== null) {
            body.stream = explicitStream;
            streamRequested = explicitStream;
        }
        return { body, streamRequested };
    }

    if (provider === REQUEST_PROVIDER.ANTHROPIC) {
        const seedMessages = normalizeConversationMessages(body.messages);
        const mergedMessages = mergeConversation(seedMessages, runtimeMessages, prompt);
        const { systemText, conversation } = splitSystemMessages(mergedMessages);
        body.messages = conversation.length
            ? conversation.map((item) => ({
                role: item.role === 'assistant' ? 'assistant' : 'user',
                content: item.content
            }))
            : [{ role: 'user', content: prompt }];
        const existingSystem = toText(extractInlineText(body.system));
        const mergedSystem = combineText(existingSystem, systemText);
        if (mergedSystem) {
            body.system = mergedSystem;
        } else {
            delete body.system;
        }
        delete body.prompt;
        delete body.input;
        delete body.contents;
        if (explicitStream !== null) {
            body.stream = explicitStream;
            streamRequested = explicitStream;
        }
        return { body, streamRequested };
    }

    if (provider === REQUEST_PROVIDER.GEMINI) {
        const seedMessages = normalizeGeminiContents(body.contents);
        const mergedMessages = mergeConversation(seedMessages, runtimeMessages, prompt);
        const { systemText, conversation } = splitSystemMessages(mergedMessages);
        body.contents = (conversation.length ? conversation : [{ role: 'user', content: prompt }]).map((item) => ({
            role: item.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: item.content }]
        }));
        const existingSystem = toText(extractInlineText(body.systemInstruction && body.systemInstruction.parts));
        const mergedSystem = combineText(existingSystem, systemText);
        if (mergedSystem) {
            body.systemInstruction = {
                parts: [{ text: mergedSystem }]
            };
        }
        delete body.prompt;
        delete body.input;
        delete body.messages;
        delete body.stream;
        return { body, streamRequested };
    }

    const baseMessages = Array.isArray(body.messages)
        ? normalizeConversationMessages(body.messages)
        : [];
    const hasMessagesArray = baseMessages.length > 0;

    if (hasMessagesArray) {
        body.messages = mergeConversation(baseMessages, runtimeMessages, prompt);
        return { body, streamRequested };
    }

    body.prompt = prompt;
    return { body, streamRequested };
}

function validateProviderConfig(providerInfo, endpoint, headers) {
    const host = toText(endpoint.hostname).toLowerCase();

    if (providerInfo.provider === REQUEST_PROVIDER.ANTHROPIC && hostMatches(host, 'api.anthropic.com')) {
        if (!getHeader(headers, 'x-api-key')) {
            return 'Anthropic endpoint requires x-api-key header.';
        }
        if (!getHeader(headers, 'anthropic-version')) {
            return 'Anthropic endpoint requires anthropic-version header.';
        }
    }

    if (providerInfo.provider === REQUEST_PROVIDER.GEMINI && hostMatches(host, 'generativelanguage.googleapis.com')) {
        const hasApiKeyHeader = Boolean(getHeader(headers, 'x-goog-api-key'));
        const hasApiKeyQuery = endpoint.searchParams.has('key');
        if (!hasApiKeyHeader && !hasApiKeyQuery) {
            return 'Gemini endpoint requires x-goog-api-key header or key query parameter.';
        }
    }

    return '';
}

function upgradeGeminiEndpointForStreaming(endpoint) {
    const upgraded = new URL(endpoint.toString());
    upgraded.pathname = upgraded.pathname.replace(/:generatecontent/i, ':streamGenerateContent');
    upgraded.searchParams.set('alt', 'sse');
    return upgraded;
}

function prepareAiRequest(config = {}) {
    const requestedMethod = toText(config.method || 'POST').toUpperCase() || 'POST';
    const prompt = toText(config.prompt);
    const endpoint = config.url instanceof URL ? new URL(config.url.toString()) : new URL(toText(config.url));
    const providerInfo = detectProviderFromUrl(endpoint);
    const headers = normalizeHeaders(config.headers);
    const normalizedMessages = normalizeConversationMessages(config.messages);
    let { body, streamRequested } = normalizeProviderBody(providerInfo, config.body, prompt, normalizedMessages);
    let nextEndpoint = endpoint;

    if (providerInfo.provider === REQUEST_PROVIDER.GEMINI && streamRequested && providerInfo.flavor === 'gemini-generate') {
        nextEndpoint = upgradeGeminiEndpointForStreaming(endpoint);
        providerInfo.flavor = 'gemini-stream';
    }

    if (providerInfo.provider === REQUEST_PROVIDER.GEMINI && providerInfo.flavor === 'gemini-stream') {
        streamRequested = true;
        nextEndpoint.searchParams.set('alt', 'sse');
    }

    const requiresPost = providerInfo.provider !== REQUEST_PROVIDER.GENERIC
        || Array.isArray(body.messages)
        || Array.isArray(body.contents)
        || Object.prototype.hasOwnProperty.call(body, 'input')
        || Object.prototype.hasOwnProperty.call(body, 'prompt');
    const method = requiresPost && (requestedMethod === 'GET' || requestedMethod === 'HEAD')
        ? 'POST'
        : requestedMethod;

    const validationMessage = validateProviderConfig(providerInfo, nextEndpoint, headers);
    if (validationMessage) {
        return {
            ok: false,
            message: validationMessage,
            provider: providerInfo.provider,
            flavor: providerInfo.flavor
        };
    }

    if (method !== 'GET' && method !== 'HEAD') {
        setHeaderIfMissing(headers, 'Content-Type', 'application/json');
    }

    return {
        ok: true,
        provider: providerInfo.provider,
        flavor: providerInfo.flavor,
        endpoint: nextEndpoint,
        method,
        headers,
        body,
        streamRequested,
        streamTransport: providerInfo.streamTransport
    };
}

function extractTextFromOpenAiOutput(output) {
    if (!Array.isArray(output)) return '';

    return output
        .map((item) => {
            if (!isObject(item)) return '';
            if (Array.isArray(item.content)) {
                return item.content
                    .map((part) => {
                        if (!isObject(part)) return '';
                        return toText(
                            part.text
                            || (isObject(part.delta) ? part.delta.text : '')
                            || (isObject(part.output_text) ? part.output_text.text : '')
                        );
                    })
                    .filter(Boolean)
                    .join('');
            }
            return '';
        })
        .filter(Boolean)
        .join('');
}

function extractTextFromAnthropicContent(content) {
    if (!Array.isArray(content)) return '';

    return content
        .map((item) => {
            if (!isObject(item)) return '';
            if (typeof item.text === 'string') return item.text;
            if (isObject(item.delta) && typeof item.delta.text === 'string') return item.delta.text;
            return '';
        })
        .filter(Boolean)
        .join('');
}

function extractTextFromGeminiCandidates(candidates) {
    if (!Array.isArray(candidates)) return '';

    return candidates
        .map((candidate) => {
            if (!isObject(candidate)) return '';
            const content = candidate.content;
            if (!isObject(content) || !Array.isArray(content.parts)) return '';
            return content.parts
                .map((part) => {
                    if (!isObject(part)) return '';
                    if (typeof part.text === 'string') return part.text;
                    return '';
                })
                .filter(Boolean)
                .join('');
        })
        .filter(Boolean)
        .join('');
}

function detectProviderFromPayload(payload) {
    if (payload == null) return REQUEST_PROVIDER.GENERIC;

    if (Array.isArray(payload)) {
        for (const item of payload) {
            const detected = detectProviderFromPayload(item);
            if (detected !== REQUEST_PROVIDER.GENERIC) {
                return detected;
            }
        }
        return REQUEST_PROVIDER.GENERIC;
    }

    if (!isObject(payload)) {
        return REQUEST_PROVIDER.GENERIC;
    }

    if (Array.isArray(payload.candidates)) {
        return REQUEST_PROVIDER.GEMINI;
    }

    if (Array.isArray(payload.content) && payload.content.some((item) => isObject(item) && typeof item.text === 'string')) {
        return REQUEST_PROVIDER.ANTHROPIC;
    }

    if (
        typeof payload.output_text === 'string'
        || Array.isArray(payload.output)
        || Array.isArray(payload.choices)
        || typeof payload.type === 'string' && payload.type.startsWith('response.')
    ) {
        return REQUEST_PROVIDER.OPENAI;
    }

    if (typeof payload.response === 'string' || (isObject(payload.message) && typeof payload.message.content === 'string')) {
        return REQUEST_PROVIDER.OLLAMA;
    }

    return REQUEST_PROVIDER.GENERIC;
}

function extractMessageText(payload, preferredProvider = REQUEST_PROVIDER.GENERIC) {
    if (payload == null) return '';

    if (typeof payload === 'string') {
        return payload;
    }

    if (Array.isArray(payload)) {
        return payload
            .map((item) => extractMessageText(item, preferredProvider))
            .filter(Boolean)
            .join('');
    }

    const providerOrder = [];
    const detectedProvider = detectProviderFromPayload(payload);

    if (preferredProvider && preferredProvider !== REQUEST_PROVIDER.GENERIC) {
        providerOrder.push(preferredProvider);
    }
    if (detectedProvider && !providerOrder.includes(detectedProvider)) {
        providerOrder.push(detectedProvider);
    }
    for (const provider of [
        REQUEST_PROVIDER.OPENAI,
        REQUEST_PROVIDER.ANTHROPIC,
        REQUEST_PROVIDER.GEMINI,
        REQUEST_PROVIDER.OLLAMA,
        REQUEST_PROVIDER.GENERIC
    ]) {
        if (!providerOrder.includes(provider)) {
            providerOrder.push(provider);
        }
    }

    for (const provider of providerOrder) {
        let text = '';

        if (provider === REQUEST_PROVIDER.OLLAMA) {
            if (isObject(payload.message) && typeof payload.message.content === 'string') {
                text = payload.message.content;
            } else if (typeof payload.response === 'string') {
                text = payload.response;
            }
        } else if (provider === REQUEST_PROVIDER.OPENAI) {
            if (typeof payload.output_text === 'string') {
                text = payload.output_text;
            } else if (Array.isArray(payload.choices) && payload.choices.length > 0) {
                const firstChoice = payload.choices[0];
                if (isObject(firstChoice.message) && typeof firstChoice.message.content === 'string') {
                    text = firstChoice.message.content;
                } else if (typeof firstChoice.text === 'string') {
                    text = firstChoice.text;
                } else if (isObject(firstChoice.delta)) {
                    text = toText(
                        firstChoice.delta.content
                        || extractInlineText(firstChoice.delta.content)
                    );
                }
            } else if (Array.isArray(payload.output)) {
                text = extractTextFromOpenAiOutput(payload.output);
            }
        } else if (provider === REQUEST_PROVIDER.ANTHROPIC) {
            text = extractTextFromAnthropicContent(payload.content);
            if (!text && isObject(payload.delta) && typeof payload.delta.text === 'string') {
                text = payload.delta.text;
            }
        } else if (provider === REQUEST_PROVIDER.GEMINI) {
            text = extractTextFromGeminiCandidates(payload.candidates);
        } else if (provider === REQUEST_PROVIDER.GENERIC) {
            text = toText(
                extractInlineText(payload.message)
                || extractInlineText(payload.content)
                || extractInlineText(payload.response)
            );
        }

        if (toText(text)) {
            return toText(text);
        }
    }

    return '';
}

function getErrorMessage(parsedPayload, fallbackText, statusCode) {
    if (isObject(parsedPayload) && isObject(parsedPayload.error) && typeof parsedPayload.error.message === 'string') {
        return parsedPayload.error.message;
    }

    if (isObject(parsedPayload) && typeof parsedPayload.error === 'string') {
        return parsedPayload.error;
    }

    if (isObject(parsedPayload) && typeof parsedPayload.message === 'string') {
        return parsedPayload.message;
    }

    const fallback = toText(fallbackText);
    if (fallback) return fallback;
    return `AI request failed (${statusCode})`;
}

function extractStreamDelta(provider, payload, eventName = '') {
    if (payload == null) {
        return '';
    }

    if (typeof payload === 'string') {
        return '';
    }

    const normalizedEventName = toText(eventName).toLowerCase();

    if (provider === REQUEST_PROVIDER.OLLAMA) {
        return toRawText(
            payload.response
            || (isObject(payload.message) ? payload.message.content : '')
        );
    }

    if (provider === REQUEST_PROVIDER.OPENAI) {
        if (typeof payload.delta === 'string') {
            return payload.delta;
        }
        if (Array.isArray(payload.choices) && payload.choices.length > 0) {
            const firstChoice = payload.choices[0];
            if (isObject(firstChoice.delta)) {
                const content = firstChoice.delta.content;
                if (typeof content === 'string') {
                    return content;
                }
                if (Array.isArray(content)) {
                    return extractInlineText(content);
                }
            }
        }
        if (typeof payload.type === 'string' && payload.type === 'response.output_text.delta' && typeof payload.delta === 'string') {
            return payload.delta;
        }
        if (
            typeof payload.type === 'string'
            && payload.type === 'response.output_text.delta'
            && isObject(payload.delta)
            && typeof payload.delta.text === 'string'
        ) {
            return payload.delta.text;
        }
        if (typeof payload.output_text === 'string') {
            return payload.output_text;
        }
        return '';
    }

    if (provider === REQUEST_PROVIDER.ANTHROPIC) {
        if (isObject(payload.delta) && typeof payload.delta.text === 'string') {
            return payload.delta.text;
        }
        if (
            (normalizedEventName === 'content_block_start' || payload.type === 'content_block_start')
            && isObject(payload.content_block)
            && typeof payload.content_block.text === 'string'
        ) {
            return payload.content_block.text;
        }
        return '';
    }

    if (provider === REQUEST_PROVIDER.GEMINI) {
        return extractTextFromGeminiCandidates(payload.candidates);
    }

    return extractMessageText(payload, provider);
}

async function readStream(response, options = {}) {
    const provider = options.provider || REQUEST_PROVIDER.GENERIC;
    const transport = options.transport || 'sse';
    const onStart = typeof options.onStart === 'function' ? options.onStart : null;
    const onDelta = typeof options.onDelta === 'function' ? options.onDelta : null;
    const onRawEvent = typeof options.onRawEvent === 'function' ? options.onRawEvent : null;

    if (!response.body || typeof response.body.getReader !== 'function') {
        const rawText = await response.text();
        const parsed = readJson(rawText);
        const text = toText(extractMessageText(parsed || rawText, provider));
        if (onStart) onStart();
        if (text && onDelta) onDelta(text, text, 'final');
        return {
            reply: text,
            raw: parsed || rawText,
            detectedProvider: detectProviderFromPayload(parsed) || provider
        };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let aggregatedText = '';
    const rawEvents = [];
    let started = false;
    let doneReceived = false;
    let detectedProvider = provider;

    const ensureStarted = () => {
        if (!started) {
            started = true;
            if (onStart) onStart();
        }
    };

    const emitDelta = (delta, rawType) => {
        const text = toRawText(delta);
        if (!text) return;
        ensureStarted();
        aggregatedText += text;
        if (onDelta) {
            onDelta(text, aggregatedText, rawType);
        }
    };

    const emitRawEvent = (payload, rawType) => {
        rawEvents.push(payload);
        if (onRawEvent) {
            onRawEvent(payload, rawType);
        }
        const guessedProvider = detectProviderFromPayload(payload);
        if (guessedProvider !== REQUEST_PROVIDER.GENERIC) {
            detectedProvider = guessedProvider;
        }
    };

    const processNdjsonLine = (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        let payload;
        try {
            payload = JSON.parse(trimmed);
        } catch (_) {
            return;
        }

        emitRawEvent(payload, 'json');
        const delta = extractStreamDelta(detectedProvider, payload, 'json');
        emitDelta(delta, 'json');
        if (payload && payload.done === true) {
            doneReceived = true;
        }
    };

    const processSseBlock = (block) => {
        const lines = block.split(/\r?\n/g);
        let eventName = '';
        const dataLines = [];

        for (const line of lines) {
            if (!line) continue;
            if (line.startsWith('event:')) {
                eventName = line.slice(6).trim();
            } else if (line.startsWith('data:')) {
                dataLines.push(line.slice(5).trim());
            }
        }

        if (!dataLines.length) return;
        const data = dataLines.join('\n');
        if (data === '[DONE]') {
            doneReceived = true;
            return;
        }

        let payload = data;
        try {
            payload = JSON.parse(data);
        } catch (_) {}

        emitRawEvent(payload, eventName || 'message');
        const delta = extractStreamDelta(detectedProvider, payload, eventName);
        emitDelta(delta, eventName || 'message');

        if (isObject(payload) && typeof payload.type === 'string' && /completed$|stop$/.test(payload.type)) {
            doneReceived = true;
        }
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        if (transport === 'ndjson') {
            const lines = buffer.split(/\r?\n/g);
            buffer = lines.pop() || '';
            for (const line of lines) {
                processNdjsonLine(line);
            }
            continue;
        }

        let separatorIndex = buffer.indexOf('\n\n');
        while (separatorIndex !== -1) {
            const block = buffer.slice(0, separatorIndex);
            buffer = buffer.slice(separatorIndex + 2);
            processSseBlock(block);
            separatorIndex = buffer.indexOf('\n\n');
        }
    }

    buffer += decoder.decode();
    if (buffer.trim()) {
        if (transport === 'ndjson') {
            processNdjsonLine(buffer);
        } else {
            processSseBlock(buffer);
        }
    }

    if (!aggregatedText && rawEvents.length > 0) {
        aggregatedText = extractMessageText(rawEvents, detectedProvider);
    }

    return {
        reply: aggregatedText,
        raw: rawEvents,
        detectedProvider,
        doneReceived
    };
}

module.exports = {
    REQUEST_PROVIDER,
    toText,
    toRawText,
    isObject,
    cloneJson,
    applyPromptPlaceholders,
    normalizeHeaders,
    normalizeConversationMessages,
    normalizeOpenAiResponseInput,
    normalizeGeminiContents,
    getLastUserPrompt,
    buildGeneratePromptFromMessages,
    parseJsonLines,
    readJson,
    detectProviderFromUrl,
    detectProviderFromPayload,
    extractMessageText,
    getErrorMessage,
    prepareAiRequest,
    readStream
};
