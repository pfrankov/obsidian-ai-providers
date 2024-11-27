import { EventEmitter } from 'events';

interface MockResponse {
    statusCode: number;
    headers: Record<string, string>;
    on(event: string, callback: (data?: any) => void): void;
}

class MockRequest extends EventEmitter {
    write(data: any) {}
    end() {
        // Simulate successful response
        const mockResponse: MockResponse = {
            statusCode: 200,
            headers: {},
            on: (event: string, callback: (data?: any) => void) => {
                if (event === 'data') {
                    callback(Buffer.from('mock response'));
                }
                if (event === 'end') {
                    callback();
                }
            }
        };

        process.nextTick(() => {
            this.emit('response', mockResponse);
        });
    }
}

export const remote = {
    net: {
        request: jest.fn().mockImplementation(() => {
            return new MockRequest();
        })
    }
};

export default { remote };