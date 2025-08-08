/**
 * Secure hashing utilities using SHA-256
 */

/**
 * Creates a secure hash using SHA-256
 * @param input - The string to hash
 * @param length - The desired length of the output hash (default: 16)
 * @returns Promise<string> - Hex-encoded hash
 */
export async function createSecureHash(
    input: string,
    length = 16
): Promise<string> {
    if (!crypto?.subtle) {
        throw new Error(
            'crypto.subtle is not available. This environment does not support secure hashing.'
        );
    }

    try {
        const encoder = new TextEncoder();
        const data = encoder.encode(input);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);

        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray
            .map(byte => byte.toString(16).padStart(2, '0'))
            .join('');

        return hashHex.substring(0, length);
    } catch (error) {
        throw new Error(
            `Failed to generate secure hash: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
}

// Convenience functions for specific use cases
export const createDatabaseHash = (input: string) =>
    createSecureHash(input, 16);
export const createCacheKeyHash = (input: string) =>
    createSecureHash(input, 20);
