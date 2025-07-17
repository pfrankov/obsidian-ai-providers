import { FetchSelector } from './FetchSelector';
import {
    IAIProvider,
    IAIProvidersPluginSettings,
} from '@obsidian-ai-providers/sdk';
import { electronFetch } from './electronFetch';
import { obsidianFetch } from './obsidianFetch';
import { Platform } from 'obsidian';

// Mock dependencies
jest.mock('./electronFetch');
jest.mock('./obsidianFetch');
jest.mock('./logger');
jest.mock('obsidian', () => ({
    Platform: {
        isMobileApp: false,
    },
}));

describe('FetchSelector', () => {
    let fetchSelector: FetchSelector;
    let mockProvider: IAIProvider;
    let mockSettings: IAIProvidersPluginSettings;

    beforeEach(() => {
        mockProvider = {
            id: 'test-provider',
            name: 'Test Provider',
            type: 'openai' as const,
            url: 'https://api.example.com',
            apiKey: 'test-key',
            model: 'test-model',
        };

        mockSettings = {
            useNativeFetch: false,
            providers: [],
            _version: 1,
        } as IAIProvidersPluginSettings;

        fetchSelector = new FetchSelector(mockSettings);
    });

    describe('getFetchFunction', () => {
        it('should return electronFetch by default', () => {
            const fetchFn = fetchSelector.getFetchFunction(mockProvider);
            expect(fetchFn).toBe(electronFetch);
        });

        it('should return native fetch when useNativeFetch is true', () => {
            mockSettings.useNativeFetch = true;
            const fetchFn = fetchSelector.getFetchFunction(mockProvider);
            expect(fetchFn).toBe(globalThis.fetch);
        });

        it('should return obsidianFetch for CORS-blocked providers', () => {
            fetchSelector.markBlocked(mockProvider);
            const fetchFn = fetchSelector.getFetchFunction(mockProvider);
            expect(fetchFn).toBe(obsidianFetch);
        });

        it('should return obsidianFetch on mobile platform', () => {
            (Platform as any).isMobileApp = true;
            const fetchFn = fetchSelector.getFetchFunction(mockProvider);
            expect(fetchFn).toBe(obsidianFetch);
        });
    });

    describe('CORS Error Detection', () => {
        it('should detect CORS errors', () => {
            const corsErrors = [
                new Error('CORS policy blocked the request'),
                new Error('Failed to fetch'),
                new Error('Network error'),
            ];

            corsErrors.forEach(error => {
                expect(fetchSelector.isCorsError(error)).toBe(true);
            });
        });

        it('should not detect non-CORS errors', () => {
            const nonCorsErrors = [
                new Error('Invalid API key'),
                new Error('Server error 500'),
            ];

            nonCorsErrors.forEach(error => {
                expect(fetchSelector.isCorsError(error)).toBe(false);
            });
        });
    });

    describe('Provider Management', () => {
        it('should mark and check blocked providers', () => {
            expect(fetchSelector.isBlocked(mockProvider)).toBe(false);

            fetchSelector.markBlocked(mockProvider);
            expect(fetchSelector.isBlocked(mockProvider)).toBe(true);
            expect(fetchSelector.getBlockedProviderCount()).toBe(1);
        });

        it('should clear blocked providers', () => {
            fetchSelector.markBlocked(mockProvider);
            fetchSelector.clear();
            expect(fetchSelector.getBlockedProviderCount()).toBe(0);
        });
    });
});
