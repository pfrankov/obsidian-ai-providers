import { requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { logger } from './logger';
import { normalizeHeaders } from './normalizeHeaders';

export const obsidianFetch = async (
    url: string,
    options: RequestInit = {}
): Promise<Response> => {
    // Convert headers to plain object and remove content-length
    const headers = normalizeHeaders(options.headers);
    delete headers['content-length'];

    // Unfortunatelly, requestUrl doesn't support abort controller
    //
    // const params: { controller?: AbortController } = {};
    // if (this && 'controller' in this) {
    //     params.controller = this.controller;
    // }

    logger.debug('obsidianFetch request:', {
        url,
        method: options.method || 'GET',
        headers,
        hasBody: !!options.body,
    });

    const requestParams: RequestUrlParam = {
        url,
        method: options.method || 'GET',
        headers,
    };

    if (options.body) {
        requestParams.body = options.body as string;

        logger.debug('Request body prepared:', requestParams.body);
    }

    try {
        logger.debug('Sending request via requestUrl');
        const obsidianResponse: RequestUrlResponse =
            await requestUrl(requestParams);

        logger.debug('Response received:', {
            status: obsidianResponse.status,
            headers: obsidianResponse.headers,
            contentLength: obsidianResponse.text.length,
        });

        const responseInit: ResponseInit = {
            status: obsidianResponse.status,
            headers: obsidianResponse.headers,
        };

        return new Response(obsidianResponse.text, responseInit);
    } catch (error) {
        logger.error('Request failed:', error, { headers });
        throw error;
    }
};
