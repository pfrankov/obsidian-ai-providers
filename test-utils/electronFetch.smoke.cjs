// Real Electron net + Web Streams smoke. Run with Electron on a desktop runner.
// Obsidian's platform flag, remote bridge, logging, and unused headers are stubbed.
const { app, net } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { ReadableStream, TransformStream } = require('node:stream/web');
const ts = require('typescript');

app.setPath(
    'userData',
    fs.mkdtempSync(path.join(os.tmpdir(), 'ai-providers-smoke-'))
);
app.disableHardwareAcceleration();

const logger = { debug() {}, debugChunk() {}, error() {} };
const modules = {
    electron: { remote: { net } },
    obsidian: { Platform: { isMobileApp: false } },
    './logger': { logger },
    './normalizeHeaders': { normalizeHeaders: () => ({}) },
};
const output = {};
const source = fs.readFileSync(
    path.join(__dirname, '../src/utils/electronFetch.ts'),
    'utf8'
);
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
    },
}).outputText;
vm.runInNewContext(compiled, {
    exports: output,
    require: id => modules[id],
    AbortController,
    ReadableStream,
    TransformStream,
    Response,
    Request,
    URL,
    Uint8Array,
});

const connections = new Map();
const server = http.createServer((request, response) => {
    connections.set(
        request.url,
        new Promise(resolve => response.once('close', resolve))
    );
    if (request.url === '/before-headers') return;
    response.writeHead(200, { 'Content-Type': 'text/plain' });
    response.write('first');
    if (request.url === '/complete') response.end('second');
});

const timeout = setTimeout(() => {
    console.error('Electron transport smoke timed out');
    server.closeAllConnections();
    app.exit(1);
}, 20000);

app.whenReady()
    .then(async () => {
        await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
        const base = `http://127.0.0.1:${server.address().port}`;

        console.log('Checking cancellation before headers');
        const before = new AbortController();
        const pendingFetch = output.electronFetch(`${base}/before-headers`, {
            signal: before.signal,
        });
        before.abort();
        await assert.rejects(pendingFetch, /Aborted/);

        console.log('Checking cancellation during streaming');
        const during = new AbortController();
        const response = await output.electronFetch(`${base}/during`, {
            signal: during.signal,
        });
        const reader = response.body.getReader();
        assert.equal(
            new TextDecoder().decode((await reader.read()).value),
            'first'
        );
        const pendingRead = reader.read();
        during.abort();
        await assert.rejects(pendingRead, /Aborted/);
        await connections.get('/during');

        console.log('Checking consumer cancellation');
        const cancelled = await output.electronFetch(`${base}/cancel`);
        await cancelled.body.cancel();
        await connections.get('/cancel');

        console.log('Checking complete response');
        const complete = new AbortController();
        const completed = await output.electronFetch(`${base}/complete`, {
            signal: complete.signal,
        });
        assert.equal(await completed.text(), 'firstsecond');
        complete.abort();
        console.log(
            'Electron transport smoke passed: abort before headers, during stream, reader cancel, complete response'
        );
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
