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
 * and CORS retry logic in a single, testable module
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
     * Get the appropriate fetch function for a provider based on settings, platform, and CORS status
     */
    getFetchFunction(provider: IAIProvider): FetchFunction {
        const providerName = provider.name;

        // Priority 1: Use obsidianFetch for CORS-blocked providers
        if (this.shouldUseFallback(provider)) {
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
     * Execute an operation with automatic CORS retry logic
     */
    async executeWithCorsRetry<T>(
        provider: IAIProvider,
        operation: (fetchImpl: FetchFunction) => Promise<T>,
        operationName: string
    ): Promise<T> {
        logger.debug(`Starting ${operationName} for provider:`, provider.name);

        // Use obsidianFetch directly for already blocked providers
        if (this.shouldUseFallback(provider)) {
            return this.executeWithFallback(provider, operation, operationName);
        }

        // Try with default fetch first, then retry with obsidianFetch if CORS error
        return this.executeWithRetry(provider, operation, operationName);
    }

    /**
     * Execute operation with obsidianFetch directly (for blocked providers)
     */
    private async executeWithFallback<T>(
        provider: IAIProvider,
        operation: (fetchImpl: FetchFunction) => Promise<T>,
        operationName: string
    ): Promise<T> {
        logger.debug(
            `${operationName}: Provider already marked for CORS, using obsidianFetch directly.`
        );
        return operation(obsidianFetch);
    }

    /**
     * Execute operation with retry logic on CORS errors
     */
    private async executeWithRetry<T>(
        provider: IAIProvider,
        operation: (fetchImpl: FetchFunction) => Promise<T>,
        operationName: string
    ): Promise<T> {
        const defaultFetch = this.getDefaultFetchForRetry(
            provider,
            operationName
        );

        try {
            const result = await operation(defaultFetch);
            logger.debug(
                `${operationName} completed successfully with default fetch.`
            );
            return result;
        } catch (error) {
            if (this.isCorsError(error as Error)) {
                return this.retryWithObsidianFetch(
                    provider,
                    operation,
                    operationName
                );
            }
            throw error;
        }
    }

    /**
     * Retry operation with obsidianFetch after CORS error
     */
    private async retryWithObsidianFetch<T>(
        provider: IAIProvider,
        operation: (fetchImpl: FetchFunction) => Promise<T>,
        operationName: string
    ): Promise<T> {
        logger.debug(
            `CORS error detected in ${operationName}, retrying with obsidianFetch`
        );
        this.markProviderAsCorsBlocked(provider);

        try {
            const result = await operation(obsidianFetch);
            logger.debug(
                `${operationName} succeeded on retry with obsidianFetch.`
            );
            return result;
        } catch (retryError) {
            logger.error(
                `${operationName} failed on retry with obsidianFetch:`,
                retryError
            );
            throw retryError;
        }
    }

    /**
     * Get the default fetch function for retry logic (ignores CORS blocking and mobile platform)
     */
    private getDefaultFetchForRetry(
        provider: IAIProvider,
        operationName: string
    ): FetchFunction {
        const providerName = provider.name;

        // Use native fetch if enabled in settings
        if (this.shouldUseNativeFetch()) {
            logger.debug(
                `Using native fetch for retry logic (${operationName}):`,
                providerName
            );
            return globalThis.fetch;
        }

        // For non-execute operations, use obsidianFetch to avoid CORS issues
        if (operationName !== 'execute') {
            logger.debug(
                `Using obsidianFetch for retry logic (${operationName}):`,
                providerName
            );
            return obsidianFetch;
        }

        // Default to electronFetch for execute operations
        logger.debug(
            `Using electronFetch for retry logic (${operationName}):`,
            providerName
        );
        return electronFetch;
    }

    /**
     * Check if a provider should use obsidianFetch due to CORS issues
     */
    shouldUseFallback(provider: IAIProvider): boolean {
        const key = this.getProviderKey(provider);
        return this.corsBlockedProviders.has(key);
    }

    /**
     * Mark a provider as having CORS issues
     */
    markProviderAsCorsBlocked(provider: IAIProvider): void {
        const key = this.getProviderKey(provider);
        this.corsBlockedProviders.add(key);
        logger.debug('Provider marked as CORS blocked:', {
            key,
            provider: provider.name,
        });
    }

    /**
     * Check if an error is CORS-related
     */
    isCorsError(error: Error): boolean {
        const errorMessage = error.message.toLowerCase();
        const errorName = error.name?.toLowerCase() || '';

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
     * Clear all CORS blocked providers (for testing or reset)
     */
    clearAll(): void {
        this.corsBlockedProviders.clear();
        logger.debug('All CORS blocked providers cleared');
    }

    /**
     * Get current count of CORS blocked providers
     */
    getBlockedProviderCount(): number {
        return this.corsBlockedProviders.size;
    }
}
