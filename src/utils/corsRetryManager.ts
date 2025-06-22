import { IAIProvider } from '@obsidian-ai-providers/sdk';
import { logger } from './logger';
import { obsidianFetch } from './obsidianFetch';
import { electronFetch } from './electronFetch';

/**
 * Service for managing providers that have CORS issues and need to use obsidianFetch
 */
export class CorsRetryManager {
    private static instance: CorsRetryManager;
    private corsProviders = new Set<string>();

    private constructor() {}

    static getInstance(): CorsRetryManager {
        if (!CorsRetryManager.instance) {
            CorsRetryManager.instance = new CorsRetryManager();
        }
        return CorsRetryManager.instance;
    }

    /**
     * Generate a unique key for a provider
     */
    private getProviderKey(provider: IAIProvider): string {
        return `${provider.url || 'unknown'}:${provider.type}`;
    }

    /**
     * Check if a provider should use obsidianFetch due to CORS issues
     */
    shouldUseFallback(provider: IAIProvider): boolean {
        const key = this.getProviderKey(provider);
        return this.corsProviders.has(key);
    }

    /**
     * Mark a provider as having CORS issues
     */
    markProviderAsCorsBlocked(provider: IAIProvider): void {
        const key = this.getProviderKey(provider);
        this.corsProviders.add(key);
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

        // CORS-related patterns
        const corsPatterns = [
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
        ];

        const isCors = corsPatterns.some(
            pattern =>
                errorMessage.includes(pattern) || errorName.includes(pattern)
        );

        logger.debug('CORS error detection result:', { isCors });
        return isCors;
    }

    /**
     * Clear all CORS blocked providers (for testing or reset)
     */
    clearAll(): void {
        this.corsProviders.clear();
        logger.debug('All CORS blocked providers cleared');
    }

    /**
     * Get current count of CORS blocked providers
     */
    getBlockedProviderCount(): number {
        return this.corsProviders.size;
    }
}

/**
 * Helper function to handle CORS retry logic uniformly across handlers
 */
export async function withCorsRetry<T>(
    provider: IAIProvider,
    operation: (
        fetchImpl: typeof electronFetch | typeof obsidianFetch
    ) => Promise<T>,
    defaultFetch: typeof electronFetch | typeof obsidianFetch,
    operationName: string
): Promise<T> {
    logger.debug(`Starting ${operationName} for provider:`, provider.name);

    if (corsRetryManager.shouldUseFallback(provider)) {
        logger.debug(
            `${operationName}: Provider already marked for CORS, using obsidianFetch directly.`
        );
        return operation(obsidianFetch);
    }

    try {
        const result = await operation(defaultFetch);
        logger.debug(
            `${operationName} completed successfully with default fetch.`
        );
        return result;
    } catch (error) {
        if (corsRetryManager.isCorsError(error as Error)) {
            logger.debug(
                `CORS error detected in ${operationName}, retrying with obsidianFetch`
            );
            corsRetryManager.markProviderAsCorsBlocked(provider);

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
        throw error;
    }
}

/**
 * Global instance for convenience
 */
export const corsRetryManager = CorsRetryManager.getInstance();
