// @ts-ignore
import { remote, IncomingMessage } from "electron";
import { Platform } from "obsidian";

export async function electronFetch(url: string, options: RequestInit = {}): Promise<Response> {
    const params: { controller?: AbortController } = {};
    if (this && 'controller' in this) {
        params.controller = this.controller;
    }

    if (Platform.isMobileApp) {
        return fetch(url, {
            ...options,
            signal: params.controller?.signal || options.signal,
        });
    }

    return new Promise((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timeout);
            request.removeAllListeners();
        };

        const request = remote.net.request({
            url,
            method: options.method || 'GET',
            headers: options.headers as Record<string, string>,
        });

        if (params.controller?.signal.aborted) {
            request.abort();
            reject(new Error('Aborted'));
            return;
        }

        params.controller?.signal.addEventListener('abort', () => {
            cleanup();
            request.abort();
            reject(new Error('Aborted'));
        });

        const timeout = setTimeout(() => {
            cleanup();
            request.abort();
            reject(new Error('Request timeout'));
        }, 10000);

        request.on('response', (response: IncomingMessage) => {
            if (params.controller?.signal.aborted) {
                return;
            }

            const { readable, writable } = new TransformStream({
                transform(chunk, controller) {
                    controller.enqueue(new Uint8Array(chunk));
                }
            });
            const writer = writable.getWriter();

            const responseInit: ResponseInit = {
                status: response.statusCode || 200,
                headers: response.headers as HeadersInit,
            };
            resolve(new Response(readable, responseInit));

            response.on('data', async (chunk: Buffer) => {
                try {
                    await writer.ready;
                    await writer.write(chunk);
                } catch (error) {
                    cleanup();
                    writer.abort(error);
                }
            });

            response.on('end', async () => {
                try {
                    await writer.ready;
                    await writer.close();
                } finally {
                    cleanup();
                }
            });

            response.on('error', (error: Error) => {
                cleanup();
                writer.abort(error);
                reject(error);
            });
        });

        request.on('error', (error: Error) => {
            cleanup();
            reject(error);
        });

        if (options.body) {
            const body = options.body instanceof Buffer ? options.body :
                typeof options.body === 'string' ? options.body :
                JSON.stringify(options.body);
            request.write(body);
        }

        request.end();
    });
}
