// Loopback-only synthetic endpoint for the real Obsidian manual smoke test.
// Logs request shape only: never headers, prompts, API keys, or generated notes.
const http = require('node:http');
const models = ['fixture-alpha', 'fixture-beta'];
const modes = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const server = http.createServer(async (request, response) => {
    if (request.method === 'GET' && request.url === '/v1/models') {
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ data: models.map(id => ({ id })) }));
        return;
    }
    if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404).end();
        return;
    }
    let body;
    try {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
        response.writeHead(400).end();
        return;
    }
    const mode = body.reasoning_effort;
    console.log(
        JSON.stringify({
            model: body.model,
            stream: body.stream,
            temperature: body.temperature,
            top_p: body.top_p,
            logprobs: body.logprobs,
            top_logprobs: body.top_logprobs,
            reasoning_effort: mode === undefined ? '(omitted)' : mode,
            sdkParameterLeaked: Object.hasOwn(body, 'reasoningMode'),
        })
    );
    if (mode !== undefined && !modes.includes(mode)) {
        response.writeHead(400, { 'content-type': 'application/json' });
        response.end(
            JSON.stringify({
                error: { message: 'Unsupported synthetic reasoning mode' },
            })
        );
        return;
    }
    response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
    });
    const words =
        'Synthetic fixture response. This is not a real model or a latency measurement.'.split(
            ' '
        );
    const timer = setInterval(() => {
        const word = words.shift();
        if (word === undefined) {
            clearInterval(timer);
            response.end('data: [DONE]\n\n');
            return;
        }
        response.write(
            `data: ${JSON.stringify({ id: 'synthetic', choices: [{ index: 0, delta: { content: word + ' ' }, finish_reason: null }] })}\n\n`
        );
    }, 100);
    response.on('close', () => clearInterval(timer));
});
server.listen(0, '127.0.0.1', () => {
    console.log(
        `Synthetic Obsidian fixture: http://127.0.0.1:${server.address().port}/v1`
    );
});
