import { OpenAIHandler } from './OpenAIHandler';
import { IAIProvider } from '../types';
import { createAIHandlerTests, IMockClient } from '../../test-utils/createAIHandlerTests';

jest.mock('openai');

const createHandler = () => new OpenAIHandler();

const createMockProvider = (): IAIProvider => ({
    id: 'test-provider',
    name: 'Test Provider',
    type: 'openai',
    url: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    model: {
        id: 'gpt-4'
    }
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

createAIHandlerTests(
    'OpenAIHandler',
    createHandler,
    createMockProvider,
    createMockClient,
    'model',
    {
        mockStreamResponse: {
            choices: [{ delta: { content: 'test response' } }]
        }
    }
); 