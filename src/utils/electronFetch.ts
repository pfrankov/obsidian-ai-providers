// @ts-ignore
import { remote, IncomingMessage } from "electron";
import { Platform } from "obsidian";
import { logger } from './logger';

export async function electronFetch(url: string, options: RequestInit = {}): Promise<Response> {
    delete (options.headers as Record<string, string>)["content-length"];
    const params: { controller?: AbortController } = {};
    if (this && 'controller' in this) {
        params.controller = this.controller;
    }

    logger.debug('electronFetch request:', {
        url,
        method: options.method || 'GET',
        headers: options.headers,
        hasBody: !!options.body,
        platform: Platform.isMobileApp ? 'mobile' : 'desktop'
    });

    if (Platform.isMobileApp) {
        logger.debug('Using native fetch (mobile platform)');
        return fetch(url, {
            ...options,
            signal: params.controller?.signal || options.signal,
        });
    }

    return new Promise((resolve, reject) => {
        const cleanup = () => {
            request.removeAllListeners();
            logger.debug('Request cleanup completed');
        };

        const request = remote.net.request({
            url,
            method: options.method || 'GET'
        });

        if (options.headers) {
            Object.entries(options.headers).forEach(([key, value]) => {
                request.setHeader(key, value);
            }); 
        }

        if (params.controller?.signal.aborted) {
            logger.debug('Request aborted before start');
            request.abort();
            reject(new Error('Aborted'));
            return;
        }

        params.controller?.signal.addEventListener('abort', () => {
            logger.debug('Request aborted by controller');
            cleanup();
            request.abort();
            reject(new Error('Aborted'));
        });

        request.on('response', (response: IncomingMessage) => {
            if (params.controller?.signal.aborted) {
                logger.debug('Request aborted during response');
                return;
            }

            logger.debug('Response received:', {
                status: response.statusCode,
                headers: response.headers
            });

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
                    logger.debug('Chunk received:', { size: chunk.length });
                } catch (error) {
                    logger.error('Error writing chunk:', error);
                    cleanup();
                    writer.abort(error);
                }
            });

            response.on('end', async () => {
                try {
                    await writer.ready;
                    await writer.close();
                    logger.debug('Response stream completed');
                } catch (error) {
                    logger.error('Error closing writer:', error);
                } finally {
                    cleanup();
                }
            });

            response.on('error', (error: Error) => {
                logger.error('Response error:', error);
                cleanup();
                writer.abort(error);
                reject(error);
            });
        });

        request.on('error', (error: Error) => {
            logger.error('Request error:', error);
            cleanup();
            reject(error);
        });

        if (options.body) {
            request.write(options.body);
        }

        request.end();
        logger.debug('Request sent');
    });
}


// return new Promise((resolve, reject) => {
//     const request = remote.net.request({
//         method: options.method,
//         url: options.url,
//     });
//     logger.debug("Request url:", options.url);

//     if (options.abortController.signal.aborted) {
//         handlers.onError(new Error("Request aborted"));
//         reject();
//         return;
//     }

//     options.abortController.signal.addEventListener("abort", () => {
//         logger.warn("Request aborted");
//         request.abort();
//         handlers.onError(new Error("Request aborted"));
//         reject();
//     });

//     if (options.headers) {
//         Object.entries(options.headers).forEach(([key, value]) => {
//             request.setHeader(key, value);
//         });
//     }

//     request.on("response", (response: any) => {
//         logger.table("Response headers:", {
//             statusCode: response.statusCode,
//             ...response.headers,
//         });

//         response.on("data", (chunk: Buffer) => {
//             if (options.abortController.signal.aborted) {
//                 handlers.onError(new Error("Request aborted"));
//                 reject();
//                 return;
//             }
//             handlers.onData(chunk.toString("utf8"));
//         });
//         response.on("end", () => {
//             logger.debug("Response end");
//             handlers.onEnd();
//             resolve();
//         });
//     });

//     request.on("error", (error: Error) => {
//         handlers.onError(error);
//         reject(error);
//     });

//     if (options.body) {
//         request.write(options.body);
//     }

//     request.end();
// });
