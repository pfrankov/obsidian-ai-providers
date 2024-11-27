import { OpenAIHandler } from './OpenAIHandler';
import { IAIProvider } from '../types';
import { createAIHandlerTests, IMockClient, IVerifyApiCallsParams } from '../../test-utils/createAIHandlerTests';

jest.mock('openai');

const createHandler = () => new OpenAIHandler({
    _version: 1,
    debugLogging: false,
    useNativeFetch: false
});

const createMockProvider = (): IAIProvider => ({
    id: 'test-provider',
    name: 'Test Provider',
    type: 'openai',
    url: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    model: 'gpt-4'
});

const createMockClient = (): IMockClient => ({
    models: {
        list: jest.fn().mockResolvedValue({
            data: [
                { id: 'model1' },
                { id: 'model2' }
            ]
        })
    },
    chat: {
        completions: {
            create: jest.fn().mockImplementation(async (_params, { signal }) => {
                const responseStream = {
                    async *[Symbol.asyncIterator]() {
                        for (let i = 0; i < 5; i++) {
                            if (signal?.aborted) {
                                break;
                            }
                            yield { choices: [{ delta: { content: `chunk${i}` } }] };
                            await new Promise(resolve => setTimeout(resolve, 100));
                        }
                    }
                };
                return responseStream;
            })
        }
    }
});

const verifyApiCalls = ({ mockClient, executeParams }: IVerifyApiCallsParams) => {
    expect(mockClient.chat?.completions.create).toHaveBeenCalledWith(
        {
            model: executeParams.provider.model,
            messages: [
                { role: 'system', content: executeParams.systemPrompt },
                { role: 'user', content: executeParams.prompt }
            ],
            stream: true
        },
        expect.any(Object)
    );
};

createAIHandlerTests(
    'OpenAIHandler',
    createHandler,
    createMockProvider,
    createMockClient,
    verifyApiCalls,
    {
        mockStreamResponse: {
            choices: [{ delta: { content: 'test response' } }]
        }
    }
); 