// Minimal Node-friendly shim for 'obsidian' used by benchmark runtime

export class App {
    appId = 'benchmark-app-id';
}

export class Notice {
    constructor(_message: string) {}
}

export const Platform = {
    isMobileApp: false,
};

export type RequestUrlParam = {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
};

export type RequestUrlResponse = {
    status: number;
    headers: Record<string, string>;
    text: string;
};

export async function requestUrl(params: RequestUrlParam): Promise<RequestUrlResponse> {
    const res = await fetch(params.url, {
        method: params.method || 'GET',
        headers: params.headers,
        body: params.body,
    });
    const text = await res.text();
    const headers: Record<string, string> = {};
    res.headers.forEach((value, key) => {
        headers[key] = value;
    });
    return {
        status: res.status,
        headers,
        text,
    };
}

// Stubs to satisfy types used elsewhere (no-ops in benchmark runtime)
export class Plugin {}
export class PluginSettingTab {}
export class Modal { constructor(public app: App) {} }
export function addIcon(_name: string, _icon: string) {}
export function setIcon(_el: HTMLElement, _name: string) {}


