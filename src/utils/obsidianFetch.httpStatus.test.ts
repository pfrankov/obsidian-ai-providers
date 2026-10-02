import type {
    IAIProvider,
    IAIProvidersPluginSettings,
} from '@obsidian-ai-providers/sdk';
import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import OpenAI from 'openai';
import { FetchFunction, FetchSelector } from './FetchSelector';
import { obsidianFetch } from './obsidianFetch';

type HttpResponse = Pick<RequestUrlResponse, 'status' | 'headers' | 'text'>;
const { requestUrlMock } = vi.hoisted(() => ({
    requestUrlMock: vi.fn<(params: RequestUrlParam) => Promise<HttpResponse>>(),
}));

vi.mock('obsidian', () => ({
    requestUrl: requestUrlMock,
    Platform: { isMobileApp: false },
}));
vi.mock('./electronFetch');
vi.mock('./logger');

// Obsidian rejects HTTP 400+ by default; merely resolving a mocked error
// response would not detect an adapter that forgets to disable that behavior.
function mockHttpResponses(responses: HttpResponse[]) {
    let index = 0;
    requestUrlMock.mockImplementation(async params => {
        const response = responses[Math.min(index++, responses.length - 1)];
        if (response.status >= 400 && params.throw !== false) {
            throw new Error(`Request failed, status ${response.status}`);
        }
        return response;
    });
}

const provider: IAIProvider = {
    id: 'test-provider',
    name: 'Test Provider',
    type: 'openai',
    url: 'https://api.example.com/v1',
    apiKey: 'test-key',
    model: 'test-model',
};
const settings = {
    providers: [],
    useNativeFetch: false,
    _version: 1,
} as IAIProvidersPluginSettings;
const errorBody = {
    error: {
        message: 'Provider rejected the request',
        type: 'provider_error',
        code: 'test_error',
        param: null,
    },
};
const headers = {
    'content-type': 'application/json',
    'retry-after': '2',
    'x-request-id': 'test-request-id',
};

function createClient(fetch: FetchFunction, maxRetries: number) {
    return new OpenAI({
        apiKey: provider.apiKey,
        baseURL: provider.url,
        dangerouslyAllowBrowser: true,
        fetch,
        maxRetries,
    });
}

describe('obsidianFetch HTTP status contract', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([200, 401, 403, 429])(
        'returns a real Response with status %i, headers and body',
        async status => {
            const text = JSON.stringify(errorBody);
            mockHttpResponses([{ status, headers, text }]);

            const response = await obsidianFetch(provider.url!);

            expect(response).toBeInstanceOf(Response);
            expect(response.status).toBe(status);
            expect(response.ok).toBe(status === 200);
            expect(response.headers.get('retry-after')).toBe('2');
            expect(response.headers.get('x-request-id')).toBe(
                'test-request-id'
            );
            expect(await response.text()).toBe(text);
            expect(requestUrlMock).toHaveBeenCalledExactlyOnceWith({
                url: provider.url,
                method: 'GET',
                headers: {},
                throw: false,
            });
        }
    );

    it.each([
        [401, OpenAI.AuthenticationError],
        [403, OpenAI.PermissionDeniedError],
        [429, OpenAI.RateLimitError],
    ] as const)(
        'preserves SDK HTTP %i errors without a selector fallback when retries are disabled',
        async (status, ErrorClass) => {
            mockHttpResponses([
                { status, headers, text: JSON.stringify(errorBody) },
            ]);
            const selector = new FetchSelector(settings);
            const operation = vi.fn(async (fetch: FetchFunction) => {
                return createClient(fetch, 0).models.list();
            });

            const result = selector.request(provider, operation);

            await expect(result).rejects.toBeInstanceOf(ErrorClass);
            await expect(result).rejects.toMatchObject({
                status,
                error: errorBody.error,
                code: 'test_error',
                requestID: 'test-request-id',
            });
            const error = await result.catch(error => error);
            expect(error.headers.get('retry-after')).toBe('2');
            expect(error.headers.get('x-request-id')).toBe('test-request-id');
            expect(operation).toHaveBeenCalledExactlyOnceWith(obsidianFetch);
            expect(requestUrlMock).toHaveBeenCalledTimes(1);
            expect(selector.isBlocked(provider)).toBe(false);
            expect(selector.getBlockedProviderCount()).toBe(0);
        }
    );

    it('honors Retry-After within one selector operation when the SDK retries a 429', async () => {
        vi.useFakeTimers();
        const models = { object: 'list', data: [{ id: 'test-model' }] };
        mockHttpResponses([
            { status: 429, headers, text: JSON.stringify(errorBody) },
            { status: 200, headers, text: JSON.stringify(models) },
        ]);
        const selector = new FetchSelector(settings);
        const operation = vi.fn(async (fetch: FetchFunction) => {
            return createClient(fetch, 1).models.list();
        });

        const result = selector.request(provider, operation);
        await vi.advanceTimersByTimeAsync(0);
        expect(requestUrlMock).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1999);
        expect(requestUrlMock).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1);
        await expect(result).resolves.toMatchObject(models);
        expect(requestUrlMock).toHaveBeenCalledTimes(2);
        expect(operation).toHaveBeenCalledExactlyOnceWith(obsidianFetch);
        expect(selector.isBlocked(provider)).toBe(false);
        expect(selector.getBlockedProviderCount()).toBe(0);
    });

    it.each([
        new TypeError('Network error'),
        new DOMException('Request aborted', 'AbortError'),
    ])('preserves rejected transport error identity: $name', async error => {
        requestUrlMock.mockRejectedValue(error);

        await expect(obsidianFetch(provider.url!)).rejects.toBe(error);
        expect(requestUrlMock).toHaveBeenCalledTimes(1);
    });
});
