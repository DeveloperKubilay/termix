const test = require('node:test');
const assert = require('node:assert/strict');
const { ReadableStream } = require('node:stream/web');

const {
    REQUEST_PROVIDER,
    detectProviderFromUrl,
    prepareAiRequest,
    extractMessageText,
    readStream
} = require('../util/ai-provider');

function createStreamResponse(chunks) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(encoder.encode(chunk));
            }
            controller.close();
        }
    });

    return new Response(stream, {
        status: 200,
        headers: {
            'Content-Type': 'text/event-stream'
        }
    });
}

test('detectProviderFromUrl identifies supported provider families', () => {
    assert.equal(
        detectProviderFromUrl(new URL('http://localhost:11434/api/generate')).provider,
        REQUEST_PROVIDER.OLLAMA
    );
    assert.equal(
        detectProviderFromUrl(new URL('https://api.openai.com/v1/chat/completions')).provider,
        REQUEST_PROVIDER.OPENAI
    );
    assert.equal(
        detectProviderFromUrl(new URL('https://api.anthropic.com/v1/messages')).provider,
        REQUEST_PROVIDER.ANTHROPIC
    );
    assert.equal(
        detectProviderFromUrl(new URL('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent')).provider,
        REQUEST_PROVIDER.GEMINI
    );
    assert.equal(
        detectProviderFromUrl(new URL('https://ai.randdcodes.com/v1/chat/completions')).provider,
        REQUEST_PROVIDER.OPENAI
    );
    assert.equal(
        detectProviderFromUrl(new URL('https://ai.randdcodes.com/v1/messages')).provider,
        REQUEST_PROVIDER.ANTHROPIC
    );
    assert.equal(
        detectProviderFromUrl(new URL('https://ai.randdcodes.com/v1beta/models/gemini-2.0-flash:generateContent')).provider,
        REQUEST_PROVIDER.GEMINI
    );
});

test('prepareAiRequest normalizes OpenAI chat requests without dropping custom fields', () => {
    const result = prepareAiRequest({
        method: 'GET',
        url: new URL('https://api.openai.com/v1/chat/completions'),
        headers: {
            Authorization: 'Bearer test-key'
        },
        body: {
            model: 'gpt-4.1',
            temperature: 0.3
        },
        prompt: 'Hello',
        messages: [
            { role: 'user', content: 'Hello' }
        ]
    });

    assert.equal(result.ok, true);
    assert.equal(result.method, 'POST');
    assert.equal(result.provider, REQUEST_PROVIDER.OPENAI);
    assert.equal(result.body.model, 'gpt-4.1');
    assert.equal(result.body.temperature, 0.3);
    assert.deepEqual(result.body.messages, [
        { role: 'user', content: 'Hello' }
    ]);
});

test('prepareAiRequest normalizes Anthropic messages and system prompt', () => {
    const result = prepareAiRequest({
        method: 'POST',
        url: new URL('https://api.anthropic.com/v1/messages'),
        headers: {
            'x-api-key': 'test-key',
            'anthropic-version': '2023-06-01'
        },
        body: {
            model: 'claude-sonnet',
            max_tokens: 1024,
            stream: true
        },
        prompt: 'Summarize this',
        messages: [
            { role: 'system', content: 'You are concise.' },
            { role: 'user', content: 'Summarize this' }
        ]
    });

    assert.equal(result.ok, true);
    assert.equal(result.provider, REQUEST_PROVIDER.ANTHROPIC);
    assert.equal(result.streamRequested, true);
    assert.equal(result.body.system, 'You are concise.');
    assert.deepEqual(result.body.messages, [
        { role: 'user', content: 'Summarize this' }
    ]);
    assert.equal(result.body.max_tokens, 1024);
});

test('prepareAiRequest upgrades Gemini generateContent URLs for streaming', () => {
    const result = prepareAiRequest({
        method: 'POST',
        url: new URL('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=test'),
        headers: {},
        body: {
            model: 'gemini-2.0-flash',
            stream: true
        },
        prompt: 'Describe the image',
        messages: [
            { role: 'user', content: 'Describe the image' }
        ]
    });

    assert.equal(result.ok, true);
    assert.equal(result.provider, REQUEST_PROVIDER.GEMINI);
    assert.equal(result.streamRequested, true);
    assert.match(result.endpoint.pathname, /streamGenerateContent/i);
    assert.equal(result.endpoint.searchParams.get('alt'), 'sse');
    assert.equal(Array.isArray(result.body.contents), true);
    assert.equal(result.body.stream, undefined);
});

test('extractMessageText supports OpenAI, Anthropic, Gemini and Ollama payloads', () => {
    assert.equal(
        extractMessageText({
            choices: [
                { message: { content: 'openai reply' } }
            ]
        }, REQUEST_PROVIDER.OPENAI),
        'openai reply'
    );

    assert.equal(
        extractMessageText({
            content: [
                { type: 'text', text: 'anthropic reply' }
            ]
        }, REQUEST_PROVIDER.ANTHROPIC),
        'anthropic reply'
    );

    assert.equal(
        extractMessageText({
            candidates: [
                {
                    content: {
                        parts: [{ text: 'gemini reply' }]
                    }
                }
            ]
        }, REQUEST_PROVIDER.GEMINI),
        'gemini reply'
    );

    assert.equal(
        extractMessageText({
            response: 'ollama reply'
        }, REQUEST_PROVIDER.OLLAMA),
        'ollama reply'
    );
});

test('readStream parses Ollama NDJSON streams into a final reply', async () => {
    const response = createStreamResponse([
        '{"response":"Hel"}\n{"response":"lo"}\n',
        '{"response":" world"}\n{"done":true}\n'
    ]);

    const deltas = [];
    const result = await readStream(response, {
        provider: REQUEST_PROVIDER.OLLAMA,
        transport: 'ndjson',
        onDelta: (delta) => deltas.push(delta)
    });

    assert.equal(result.reply, 'Hello world');
    assert.deepEqual(deltas, ['Hel', 'lo', ' world']);
});

test('readStream parses OpenAI SSE chat deltas', async () => {
    const response = createStreamResponse([
        'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n',
        'data: [DONE]\n\n'
    ]);

    const result = await readStream(response, {
        provider: REQUEST_PROVIDER.OPENAI,
        transport: 'sse'
    });

    assert.equal(result.reply, 'Hello');
});

test('readStream parses Anthropic SSE text deltas', async () => {
    const response = createStreamResponse([
        'event: content_block_delta\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Mer"}}\n\n',
        'event: content_block_delta\n',
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"haba"}}\n\n',
        'event: message_stop\n',
        'data: {"type":"message_stop"}\n\n'
    ]);

    const result = await readStream(response, {
        provider: REQUEST_PROVIDER.ANTHROPIC,
        transport: 'sse'
    });

    assert.equal(result.reply, 'Merhaba');
});
