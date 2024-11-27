import { OllamaHandler } from './OllamaHandler';
import { IAIProvider } from '../types';
import { createAIHandlerTests, IMockClient } from '../../test-utils/createAIHandlerTests';

jest.mock('ollama');

const createHandler = () => new OllamaHandler();

const createMockProvider = (): IAIProvider => ({
    id: 'test-provider',
    name: 'Test Provider',
    type: 'ollama',
    url: 'http://localhost:11434',
    apiKey: '',
    model: {
        id: 'llama2'
    }
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

createAIHandlerTests(
    'OllamaHandler',
    createHandler,
    createMockProvider,
    createMockClient,
    'model',
    {
        mockStreamResponse: {
            response: 'test response'
        }
    }
); 