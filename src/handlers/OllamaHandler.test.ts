import { OllamaHandler } from './OllamaHandler';
import { IAIProvider } from '../types';
import { createAIHandlerTests, IMockClient, IVerifyApiCallsParams } from '../../test-utils/createAIHandlerTests';

jest.mock('ollama');

const createHandler = () => new OllamaHandler({
    _version: 1,
    debugLogging: false,
    useNativeFetch: false
});

const createMockProvider = (): IAIProvider => ({
    id: 'test-provider',
    name: 'Test Provider',
    type: 'ollama',
    url: 'http://localhost:11434',
    apiKey: '',
    model: 'llama2'
});

const createMockClient = (): IMockClient => ({
    list: jest.fn().mockResolvedValue({
        models: [
            { name: 'model1' },
            { name: 'model2' }
        ]
    }),
    generate: jest.fn().mockImplementation(async ({ signal }) => {
        const stream = {
            async *[Symbol.asyncIterator]() {
                for (let i = 0; i < 5; i++) {
                    if (signal?.aborted) {
                        break;
                    }
                    yield { response: `chunk${i}` };
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        };
        return stream;
    })
});

const verifyApiCalls = ({ mockClient, executeParams }: IVerifyApiCallsParams) => {
    expect(mockClient.generate).toHaveBeenCalledWith({
        model: executeParams.provider.model,
        system: executeParams.systemPrompt,
        prompt: executeParams.prompt,
        stream: true
    });
};

createAIHandlerTests(
    'OllamaHandler',
    createHandler,
    createMockProvider,
    createMockClient,
    verifyApiCalls,
    {
        mockStreamResponse: {
            response: 'test response'
        }
    }
); 