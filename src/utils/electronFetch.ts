export async function electronFetch(
    url: string,
    options: RequestInit = {}
): Promise<Response> {
    const params: any = { url, ...options };

    // Note: AbortController should be passed via options.signal if needed

    const response = await (window as any).electronAPI.fetch(params);

    return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
    });
}
