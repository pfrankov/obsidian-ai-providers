import {
    IAIProvider,
    IAIProvidersPluginSettings,
} from '@obsidian-ai-providers/sdk';
import { electronFetch } from './electronFetch';
import { obsidianFetch } from './obsidianFetch';
import { Platform } from 'obsidian';
import { logger } from './logger';

export type FetchFunction =
    | typeof electronFetch
    | typeof obsidianFetch
    | typeof fetch;

/**
 * CORS error patterns for detection
 */
const CORS_ERROR_PATTERNS = [
    'cors policy',
    'cors error',
    'blocked by cors',
    'cross-origin',
    'access-control-allow-origin',
    'access-control-allow-methods',
    'access-control-allow-headers',
    'preflight request',
    'connection error',
    'network error',
    'failed to fetch',
    'typeerror: failed to fetch',
    'net::err_failed',
    'fetch error',
    'cors',
] as const;

/**
 * Unified fetch selection service that handles platform-specific fetch choice
 * and CORS retry logic in a single, testable module.
 *
 * Provides separate methods for streaming operations (execute) and API requests (request)
 * with optimized fetch function selection for each use case.
 */
export class FetchSelector {
    private corsBlockedProviders = new Set<string>();

    constructor(private settings: IAIProvidersPluginSettings) {}

    /**
     * Generate a unique key for a provider
     */
    private getProviderKey(provider: IAIProvider): string {
        return `${provider.url || 'unknown'}:${provider.type}`;
    }

    /**
     * Check if provider is mobile platform
     */
    private isMobilePlatform(): boolean {
        return Platform.isMobileApp;
    }

    /**
     * Check if native fetch should be used
     */
    private shouldUseNativeFetch(): boolean {
        return this.settings.useNativeFetch ?? false;
    }

    /**
     * Get the appropriate fetch function for API requests (fetchModels, embed)
     * Defaults to obsidianFetch for better CORS compatibility.
     *
     * Priority order:
     * 1. obsidianFetch for CORS-blocked providers
     * 2. obsidianFetch on mobile platform
     * 3. globalThis.fetch if useNativeFetch setting is enabled
     * 4. obsidianFetch as default for API requests
     */
    getFetch(provider: IAIProvider): FetchFunction {
        const providerName = provider.name;

        // Priority 1: Use obsidianFetch for CORS-blocked providers
        if (this.isBlocked(provider)) {
            logger.debug(
                'Using obsidianFetch for CORS-blocked provider (API):',
                providerName
            );
            return obsidianFetch;
        }

        // Priority 2: Use obsidianFetch on mobile platform (electronFetch not available)
        if (this.isMobilePlatform()) {
            logger.debug(
                'Using obsidianFetch for mobile platform (API):',
                providerName
            );
            return obsidianFetch;
        }

        // Priority 3: Use native fetch if enabled in settings
        if (this.shouldUseNativeFetch()) {
            logger.debug(
                'Using native fetch for provider (API):',
                providerName
            );
            return globalThis.fetch;
        }

        // Default: Use obsidianFetch for API requests
        logger.debug('Using obsidianFetch for provider (API):', providerName);
        return obsidianFetch;
    }

    /**
     * Get the appropriate fetch function for streaming operations (execute)
     * Defaults to electronFetch for better streaming performance.
     *
     * Priority order:
     * 1. obsidianFetch for CORS-blocked providers
     * 2. obsidianFetch on mobile platform
     * 3. globalThis.fetch if useNativeFetch setting is enabled
     * 4. electronFetch as default for streaming operations
     */
    getStreamingFetch(provider: IAIProvider): FetchFunction {
        const providerName = provider.name;

        // Priority 1: Use obsidianFetch for CORS-blocked providers
        if (this.isBlocked(provider)) {
            logger.debug(
                'Using obsidianFetch for CORS-blocked provider (streaming):',
                providerName
            );
            return obsidianFetch;
        }

        // Priority 2: Use obsidianFetch on mobile platform (electronFetch not available)
        if (this.isMobilePlatform()) {
            logger.debug(
                'Using obsidianFetch for mobile platform (streaming):',
                providerName
            );
            return obsidianFetch;
        }

        // Priority 3: Use native fetch if enabled in settings
        if (this.shouldUseNativeFetch()) {
            logger.debug(
                'Using native fetch for provider (streaming):',
                providerName
            );
            return globalThis.fetch;
        }

        // Default: Use electronFetch for streaming operations
        logger.debug(
            'Using electronFetch for provider (streaming):',
            providerName
        );
        return electronFetch;
    }

    /**
     * Get the appropriate fetch function for a provider based on settings, platform, and CORS status
     * @deprecated Use getFetch() for API requests or getStreamingFetch() for streaming operations instead
     */
    getFetchFunction(provider: IAIProvider): FetchFunction {
        const providerName = provider.name;

        // Priority 1: Use obsidianFetch for CORS-blocked providers
        if (this.isBlocked(provider)) {
            logger.debug(
                'Using obsidianFetch for CORS-blocked provider:',
                providerName
            );
            return obsidianFetch;
        }

        // Priority 2: Use obsidianFetch on mobile platform (electronFetch not available)
        if (this.isMobilePlatform()) {
            logger.debug(
                'Using obsidianFetch for mobile platform:',
                providerName
            );
            return obsidianFetch;
        }

        // Priority 3: Use native fetch if enabled in settings
        if (this.shouldUseNativeFetch()) {
            logger.debug('Using native fetch for provider:', providerName);
            return globalThis.fetch;
        }

        // Default: Use electronFetch on desktop
        logger.debug('Using electronFetch for provider:', providerName);
        return electronFetch;
    }

    /**
     * Check if an error is CORS-related
     */
    isCorsError(error: Error): boolean {
        // Handle null/undefined errors
        if (!error) {
            return false;
        }

        const errorMessage = (error.message || '').toLowerCase();
        const errorName = (error.name || '').toLowerCase();

        logger.debug('Checking CORS error:', {
            message: error.message,
            name: error.name,
        });

        const isCors = this.matchesCorsPattern(errorMessage, errorName);
        logger.debug('CORS error detection result:', { isCors });
        return isCors;
    }

    /**
     * Check if error message or name matches CORS patterns
     */
    private matchesCorsPattern(
        errorMessage: string,
        errorName: string
    ): boolean {
        return CORS_ERROR_PATTERNS.some(
            pattern =>
                errorMessage.includes(pattern) || errorName.includes(pattern)
        );
    }

    /**
     * Execute a streaming operation (like text generation) with automatic CORS retry.
     * Uses getStreamingFetch for optimal streaming performance.
     *
     * This method is optimized for long-running streaming connections and will:
     * - Use the best fetch function for streaming based on platform and settings
     * - Automatically retry with obsidianFetch on CORS errors
     * - Mark providers as blocked for future requests
     */
    async execute<T>(
        provider: IAIProvider,
        operation: (fetch: FetchFunction) => Promise<T>
    ): Promise<T> {
        logger.debug('Starting execute operation for provider:', provider.name);

        // Use obsidianFetch directly for already blocked providers
        if (this.isBlocked(provider)) {
            logger.debug(
                'Provider already CORS-blocked, using obsidianFetch directly'
            );
            return operation(obsidianFetch);
        }

        // Try with optimal streaming fetch first
        const fetch = this.getStreamingFetch(provider);

        try {
            const result = await operation(fetch);
            logger.debug('Execute operation completed successfully');
            return result;
        } catch (error) {
            if (this.isCorsError(error as Error)) {
                logger.debug(
                    'CORS error detected in execute, retrying with obsidianFetch'
                );
                this.markBlocked(provider);
                return operation(obsidianFetch);
            }
            throw error;
        }
    }

    /**
     * Execute an API request (like fetchModels, embed) with automatic CORS retry.
     * Uses getFetch for optimal API request handling.
     *
     * This method is optimized for short API requests and will:
     * - Use the best fetch function for API calls based on platform and settings
     * - Automatically retry with obsidianFetch on CORS errors
     * - Mark providers as blocked for future requests
     */
    async request<T>(
        provider: IAIProvider,
        operation: (fetch: FetchFunction) => Promise<T>
    ): Promise<T> {
        logger.debug('Starting request operation for provider:', provider.name);

        // Use obsidianFetch directly for already blocked providers
        if (this.isBlocked(provider)) {
            logger.debug(
                'Provider already CORS-blocked, using obsidianFetch directly'
            );
            return operation(obsidianFetch);
        }

        // Try with optimal API fetch first
        const fetch = this.getFetch(provider);

        try {
            const result = await operation(fetch);
            logger.debug('Request operation completed successfully');
            return result;
        } catch (error) {
            if (this.isCorsError(error as Error)) {
                logger.debug(
                    'CORS error detected in request, retrying with obsidianFetch'
                );
                this.markBlocked(provider);
                return operation(obsidianFetch);
            }
            throw error;
        }
    }

    /**
     * Get current count of CORS blocked providers
     */
    getBlockedProviderCount(): number {
        return this.corsBlockedProviders.size;
    }

    /**
     * Check if a provider is blocked due to CORS issues.
     * Blocked providers will automatically use obsidianFetch for all operations.
     */
    isBlocked(provider: IAIProvider): boolean {
        const key = this.getProviderKey(provider);
        return this.corsBlockedProviders.has(key);
    }

    /**
     * Mark a provider as blocked due to CORS issues.
     * This will cause all future requests to this provider to use obsidianFetch.
     */
    markBlocked(provider: IAIProvider): void {
        const key = this.getProviderKey(provider);
        this.corsBlockedProviders.add(key);
        logger.debug('Provider marked as CORS blocked:', {
            key,
            provider: provider.name,
        });
    }

    /**
     * Clear all blocked providers.
     * This will reset the CORS blocking state for all providers.
     */
    clear(): void {
        this.corsBlockedProviders.clear();
        logger.debug('All CORS blocked providers cleared');
    }
}
