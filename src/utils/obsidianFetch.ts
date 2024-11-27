import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";
import { logger } from './logger';

export const obsidianFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
    delete (options.headers as Record<string, string>)["content-length"];

    // Unfortunatelly, requestUrl doesn't support abort controller
    // 
    // const params: { controller?: AbortController } = {};
    // if (this && 'controller' in this) {
    //     params.controller = this.controller;
    // }

    logger.debug('obsidianFetch request:', {
        url,
        method: options.method || 'GET',
        headers: options.headers,
        hasBody: !!options.body
    });
    
    const requestParams: RequestUrlParam = {
        url,
        method: options.method || 'GET',
        headers: options.headers as Record<string, string>,
    };

    if (options.body) {
        requestParams.body = options.body as string;
        
        logger.debug('Request body prepared:', requestParams.body);
    }

    try {
        logger.debug('Sending request via requestUrl');
        const obsidianResponse: RequestUrlResponse = await requestUrl(requestParams);
        
        logger.debug('Response received:', {
            status: obsidianResponse.status,
            headers: obsidianResponse.headers,
            contentLength: obsidianResponse.text.length
        });

        const responseInit: ResponseInit = {
            status: obsidianResponse.status,
            headers: obsidianResponse.headers,
        };

        return new Response(obsidianResponse.text, responseInit);
    } catch (error) {
        logger.error('Request failed:', error);
        throw error;
    }
}; 