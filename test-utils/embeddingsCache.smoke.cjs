// Native IndexedDB smoke, run with Electron on a desktop runner.
// All data and the browser profile are temporary synthetic fixtures.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('esbuild');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-cache-smoke-'));
const profile = path.join(directory, 'profile');
fs.mkdirSync(profile);
app.setPath('userData', profile);
app.setPath('sessionData', profile);
app.disableHardwareAcceleration();

const timeout = setTimeout(() => {
    console.error('Electron embeddings cache smoke timed out');
    app.exit(1);
}, 20000);

app.whenReady()
    .then(async () => {
        await build({
            entryPoints: [path.join(__dirname, 'embeddingsCache.renderer.js')],
            outfile: path.join(directory, 'renderer.js'),
            bundle: true,
            platform: 'browser',
            format: 'iife',
            globalName: 'cacheSmoke',
            define: { 'process.env.NODE_ENV': '"production"' },
        });
        const html = path.join(directory, 'index.html');
        fs.writeFileSync(
            html,
            `<!doctype html><meta http-equiv="Content-Security-Policy"
            content="default-src 'none'; script-src 'self'">
            <script src="renderer.js"></script>`
        );
        const window = new BrowserWindow({
            show: false,
            webPreferences: {
                // Avoid native-window requirements on headless Linux runners.
                offscreen: true,
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
            },
        });
        window.webContents.on('console-message', details => {
            console.log(`[renderer] ${details.message}`);
        });
        await window.loadFile(html);
        console.log(
            await window.webContents.executeJavaScript('cacheSmoke.run()')
        );
        window.destroy();
        clearTimeout(timeout);
        app.exit(0);
    })
    .catch(error => {
        console.error(error);
        clearTimeout(timeout);
        app.exit(1);
    });

app.on('quit', () => fs.rmSync(directory, { recursive: true, force: true }));
