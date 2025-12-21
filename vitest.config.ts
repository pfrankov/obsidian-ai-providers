import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vitest/config';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            obsidian: path.resolve(rootDir, '__mocks__/obsidian.ts'),
            electron: path.resolve(rootDir, '__mocks__/electron.ts'),
            idb: path.resolve(rootDir, '__mocks__/idb.js'),
        },
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: [path.resolve(rootDir, 'vitest.setup.ts')],
        include: ['src/**/*.{test,spec}.ts', 'packages/**/*.{test,spec}.ts'],
        exclude: ['**/node_modules/**', '**/dist/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'lcov'],
            include: ['src/**/*.ts', 'packages/sdk/**/*.ts'],
            exclude: [
                '**/*.test.ts',
                '**/*.spec.ts',
                '**/*.d.ts',
                '**/__mocks__/**',
                '**/node_modules/**',
                '**/dist/**',
                'packages/example-plugin/**',
            ],
            thresholds: {
                lines: 100,
                functions: 100,
                branches: 100,
                statements: 100,
            },
        },
    },
});
