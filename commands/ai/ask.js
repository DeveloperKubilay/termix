const db = require('../../util/profile-db');
const { normalizeAiSettings } = require('../../util/profile-defaults');
const {
    REQUEST_PROVIDER,
    toText,
    normalizeConversationMessages,
    getLastUserPrompt,
    prepareAiRequest,
    readJson,
    detectProviderFromPayload,
    extractMessageText,
    getErrorMessage,
    readStream
} = require('../../util/ai-provider');

const REQUEST_TIMEOUT_MS = 45000;

function providerLabel(provider) {
    if (provider === REQUEST_PROVIDER.OLLAMA) return 'Ollama';
    if (provider === REQUEST_PROVIDER.OPENAI) return 'OpenAI-compatible';
    if (provider === REQUEST_PROVIDER.ANTHROPIC) return 'Anthropic';
    if (provider === REQUEST_PROVIDER.GEMINI) return 'Gemini';
    return 'AI';
}

function buildUnsupportedMessage(provider) {
    const label = providerLabel(provider);
    return label === 'AI'
        ? 'AI response is empty or unsupported.'
        : `${label} response is empty or unsupported.`;
}

function emitStreamEvent(event, payload) {
    if (!event || !event.sender || typeof event.sender.send !== 'function') {
        return;
    }

    try {
        event.sender.send('ai:stream', payload);
    } catch (err) {
        console.warn('Failed to publish AI stream event:', err);
    }
}

module.exports = async function (filesPath, payload = {}, event) {
    const requestId = toText(payload.requestId);

    try {
        const conversationMessages = normalizeConversationMessages(payload.messages);
        const prompt = toText(payload.prompt || getLastUserPrompt(conversationMessages));
        if (!prompt && conversationMessages.length === 0) {
            return { success: false, message: 'Message cannot be empty.' };
        }

        const ai = normalizeAiSettings(db.get('ai'));
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

        const requestPlan = prepareAiRequest({
            method: ai.method,
            url: endpoint,
            headers: ai.headers,
            body: ai.body,
            prompt,
            messages: conversationMessages
        });

        if (!requestPlan.ok) {
            return {
                success: false,
                message: requestPlan.message,
                provider: requestPlan.provider
            };
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        let response;
        try {
            response = await fetch(requestPlan.endpoint.toString(), {
                method: requestPlan.method,
                headers: requestPlan.headers,
                body: requestPlan.method !== 'GET' && requestPlan.method !== 'HEAD'
                    ? JSON.stringify(requestPlan.body)
                    : undefined,
                signal: controller.signal
            });
        } finally {
            clearTimeout(timeout);
        }

        if (!response.ok) {
            const rawText = await response.text();
            const parsed = readJson(rawText);
            return {
                success: false,
                message: getErrorMessage(parsed, rawText, response.status),
                status: response.status,
                provider: requestPlan.provider,
                raw: parsed || rawText
            };
        }

        if (requestPlan.streamRequested) {
            const streamResult = await readStream(response, {
                provider: requestPlan.provider,
                transport: requestPlan.streamTransport === 'ndjson' ? 'ndjson' : 'sse',
                onStart: () => {
                    if (!requestId) return;
                    emitStreamEvent(event, {
                        requestId,
                        phase: 'start',
                        provider: requestPlan.provider,
                        delta: '',
                        text: '',
                        rawType: 'start'
                    });
                },
                onDelta: (delta, text, rawType) => {
                    if (!requestId) return;
                    emitStreamEvent(event, {
                        requestId,
                        phase: 'delta',
                        provider: requestPlan.provider,
                        delta,
                        text,
                        rawType
                    });
                }
            });

            const detectedProvider = streamResult.detectedProvider || requestPlan.provider;
            const reply = toText(streamResult.reply || extractMessageText(streamResult.raw, detectedProvider));
            if (!reply) {
                return {
                    success: false,
                    message: buildUnsupportedMessage(detectedProvider),
                    status: response.status,
                    provider: detectedProvider,
                    raw: streamResult.raw
                };
            }

            if (requestId) {
                emitStreamEvent(event, {
                    requestId,
                    phase: 'complete',
                    provider: detectedProvider,
                    delta: '',
                    text: reply,
                    rawType: 'complete'
                });
            }

            return {
                success: true,
                reply,
                status: response.status,
                provider: detectedProvider,
                streamed: true,
                raw: streamResult.raw
            };
        }

        const rawText = await response.text();
        const parsed = readJson(rawText);
        const detectedProvider = (() => {
            const payloadProvider = detectProviderFromPayload(parsed);
            return payloadProvider !== REQUEST_PROVIDER.GENERIC
                ? payloadProvider
                : requestPlan.provider;
        })();
        const reply = toText(extractMessageText(parsed || rawText, detectedProvider));
        if (!reply) {
            return {
                success: false,
                message: buildUnsupportedMessage(detectedProvider),
                status: response.status,
                provider: detectedProvider,
                raw: parsed || rawText
            };
        }

        return {
            success: true,
            reply,
            status: response.status,
            provider: detectedProvider,
            streamed: false,
            raw: parsed || rawText
        };
    } catch (err) {
        if (requestId) {
            emitStreamEvent(event, {
                requestId,
                phase: 'error',
                provider: REQUEST_PROVIDER.GENERIC,
                delta: '',
                text: '',
                rawType: 'error',
                error: err && err.message ? err.message : String(err)
            });
        }

        if (err && err.name === 'AbortError') {
            return { success: false, message: 'AI request timed out.' };
        }

        return {
            success: false,
            message: err && err.message ? err.message : String(err)
        };
    }
};
