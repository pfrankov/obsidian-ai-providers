import { requestUrl, RequestUrlParam, RequestUrlResponse } from "obsidian";

export const obsidianFetch = async (url: string, options: RequestInit = {}): Promise<Response> => {
    const requestParams: RequestUrlParam = {
        url,
        method: options.method || 'GET',
        headers: options.headers as Record<string, string>,
    };

    if (options.body) {
        requestParams.body = options.body instanceof Buffer ? options.body.toString() :
                            typeof options.body === 'string' ? options.body :
                            JSON.stringify(options.body);
    }

    const obsidianResponse: RequestUrlResponse = await requestUrl(requestParams);
    
    const responseInit: ResponseInit = {
        status: obsidianResponse.status,
        headers: obsidianResponse.headers,
    };

    return new Response(obsidianResponse.text, responseInit);
}; 