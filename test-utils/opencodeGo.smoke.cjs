// Real Go handler + OpenAI SDK + Electron net against a loopback capture server.
// Only Obsidian's host bridge is shimmed; its adapter and header normalization are real.
const { app, net } = require('electron');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { build } = require('esbuild');
const { version } = require('../manifest.json');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-go-smoke-'));
app.setPath('userData', directory);
app.disableHardwareAcceleration();
const platform = { isMobileApp: false };
const captured = [];
let reply = () => 200;
let hostCalls = 0;
let electronCalls = 0;
let nativeCalls = 0;
let base;
const session = '8bcb81e7-37fc-4b09-bc22-4df28d26b101';
const uuid =
    /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const sse =
    'data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n';
const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    captured.push({
        headers: request.headers,
        method: request.method,
        url: request.url,
        body: JSON.parse(Buffer.concat(chunks).toString()),
    });
    const status = reply();
    if (status === 0) return request.socket.destroy();
    response.writeHead(status, {
        'Content-Type': 'text/event-stream',
        'X-Content-Type-Options': 'nosniff',
        'Retry-After': '0',
    });
    response.end(status === 200 ? sse : '{}');
});

// Simulates requestUrl's buffered HTTP contract, not Obsidian's native runtime.
// Never forwards test credentials or synthetic prompts off this loopback server.
async function requestUrl(params) {
    assert.equal(new URL(params.url).origin, base);
    assert.equal(params.throw, false);
    hostCalls++;
    return new Promise((resolve, reject) => {
        const request = http.request(
            params.url,
            {
                method: params.method,
                headers: params.headers,
            },
            response => {
                const chunks = [];
                response.on('data', chunk => chunks.push(chunk));
                response.on('end', () =>
                    resolve({
                        status: response.statusCode,
                        headers: response.headers,
                        text: Buffer.concat(chunks).toString(),
                    })
                );
                response.on('error', reject);
            }
        );
        request.on('error', reject);
        request.end(params.body);
    });
}

function assertWire(request, expectedSession) {
    assert.equal(request.method, 'POST');
    assert.equal(request.url, '/v1/chat/completions');
    assert.equal(
        request.headers['user-agent'],
        `obsidian-ai-providers/${version}`
    );
    assert.equal(request.headers.authorization, 'Bearer synthetic-test-key');
    assert.match(request.headers['x-opencode-session'], uuid);
    if (expectedSession !== undefined) {
        assert.equal(request.headers['x-opencode-session'], expectedSession);
    }
    assert.equal(request.body.model, 'synthetic-chat-model');
    assert.equal(request.body.stream, true);
    assert.equal(Object.hasOwn(request.body, 'conversationId'), false);
}

async function run() {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const bundle = await build({
        entryPoints: [
            path.join(__dirname, '../src/handlers/OpenCodeGoHandler.ts'),
        ],
        bundle: true,
        platform: 'node',
        format: 'cjs',
        packages: 'external',
        write: false,
    });
    const module = { exports: {} };
    vm.runInNewContext(bundle.outputFiles[0].text, {
        module,
        exports: module.exports,
        require: id => {
            if (id === 'electron')
                return {
                    remote: {
                        net: {
                            request: options => {
                                assert.equal(new URL(options.url).origin, base);
                                electronCalls++;
                                return net.request(options);
                            },
                        },
                    },
                };
            if (id === 'obsidian') return { Platform: platform, requestUrl };
            return require(id);
        },
        process,
        console,
        crypto: webcrypto,
        AbortController,
        Headers,
        Request,
        Response,
        URL,
        Uint8Array,
        TransformStream,
        // Go must never choose renderer fetch, even with useNativeFetch enabled.
        fetch: () => {
            nativeCalls++;
            throw new Error('Unexpected native fetch');
        },
    });
    const { OpenCodeGoHandler } = module.exports;
    const provider = {
        id: 'synthetic-provider',
        name: 'OpenCode Go',
        type: 'opencode-go',
        url: `${base}/v1`,
        apiKey: 'synthetic-test-key',
        model: 'synthetic-chat-model',
    };
    const execute = (handler, conversationId) =>
        handler.execute({
            provider,
            conversationId,
            prompt: 'Review this synthetic code.',
            abortController: new AbortController(),
        });
    const toolsExecute = (handler, conversationId) =>
        handler.toolsExecute({
            provider,
            conversationId,
            messages: [
                { role: 'user', content: 'Review this synthetic code.' },
            ],
            tools: [],
        });

    for (const mobile of [false, true]) {
        platform.isMobileApp = mobile;
        for (const useNativeFetch of [false, true]) {
            const handler = new OpenCodeGoHandler({
                _version: 1,
                useNativeFetch,
            });
            captured.length = 0;
            hostCalls = 0;
            assert.equal(await execute(handler, session), 'OK');
            assert.equal((await toolsExecute(handler, session)).content, 'OK');
            assert.equal(captured.length, 2);
            captured.forEach(request => assertWire(request, session));
            assert.equal(hostCalls, mobile ? 2 : 0);

            captured.length = 0;
            await Promise.all([execute(handler), toolsExecute(handler)]);
            assert.equal(captured.length, 2);
            captured.forEach(request => assertWire(request));
            assert.notEqual(
                captured[0].headers['x-opencode-session'],
                captured[1].headers['x-opencode-session']
            );
            const independentSessions = captured.map(
                request => request.headers['x-opencode-session']
            );
            await execute(handler);
            assert.equal(captured.length, 3);
            assertWire(captured[2]);
            assert.equal(
                independentSessions.includes(
                    captured[2].headers['x-opencode-session']
                ),
                false
            );

            for (const operation of [execute, toolsExecute]) {
                for (const invalid of [
                    '',
                    'notes/private.md',
                    'x\r\nx-injected: yes',
                    '8bcb81e7-37fc-1b09-bc22-4df28d26b101',
                ]) {
                    await assert.rejects(
                        operation(handler, invalid),
                        /conversationId must be a random UUID/
                    );
                }
            }
            assert.equal(captured.length, 3);
            console.log(
                `Go wire headers: ${mobile ? 'Obsidian bridge' : 'Electron net'}, useNativeFetch=${useNativeFetch}`
            );
        }
    }

    platform.isMobileApp = false;
    for (const operation of [execute, toolsExecute]) {
        for (const fallback of [false, true]) {
            const handler = new OpenCodeGoHandler({
                _version: 1,
                useNativeFetch: true,
            });
            captured.length = 0;
            hostCalls = 0;
            electronCalls = 0;
            // SDK retries a 429 once; socket failure exhausts all three Electron
            // attempts, then FetchSelector retries through the Obsidian adapter.
            reply = () =>
                fallback
                    ? hostCalls === 0
                        ? 0
                        : 200
                    : captured.length === 1
                      ? 429
                      : 200;
            await operation(handler);
            assert.equal(electronCalls, fallback ? 3 : 2);
            // Chromium may retry a reset connection below the SDK boundary.
            assert.ok(fallback ? captured.length >= 4 : captured.length === 2);
            const stable = captured[0].headers['x-opencode-session'];
            captured.forEach(request => assertWire(request, stable));
            assert.equal(hostCalls, fallback ? 1 : 0);
            console.log(
                `Go wire session stable: ${operation.name}, ${fallback ? 'SDK retries + host fallback' : '429 retry'}`
            );
        }
    }
    assert.equal(nativeCalls, 0);
    console.log('OpenCode Go wire smoke passed');
}

const timeout = setTimeout(() => {
    console.error('OpenCode Go wire smoke timed out');
    server.closeAllConnections();
    app.exit(1);
}, 30000);
app.whenReady()
    .then(run)
    .then(() => {
        clearTimeout(timeout);
        server.closeAllConnections();
        server.close();
        app.exit(0);
    })
    .catch(error => {
        console.error(error);
        clearTimeout(timeout);
        server.closeAllConnections();
        app.exit(1);
    });
app.on('quit', () => fs.rmSync(directory, { recursive: true, force: true }));
