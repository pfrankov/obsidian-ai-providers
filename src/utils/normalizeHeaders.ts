/**
 * Convert various header inputs into a plain object.
 * Guards against missing `Headers` in non-browser environments.
 */
export function normalizeHeaders(
    headers?: HeadersInit
): Record<string, string> {
    if (!headers) {
        return {};
    }

    if (typeof Headers !== 'undefined' && headers instanceof Headers) {
        const result: Record<string, string> = {};
        headers.forEach((value, key) => {
            result[key] = value;
        });
        return result;
    }

    if (Array.isArray(headers)) {
        const result: Record<string, string> = {};
        for (const [key, value] of headers) {
            result[key] = value;
        }
        return result;
    }

    return { ...(headers as Record<string, string>) };
}
