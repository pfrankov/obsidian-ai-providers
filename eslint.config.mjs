import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';

const vitestGlobals = {
    describe: 'readonly',
    it: 'readonly',
    test: 'readonly',
    expect: 'readonly',
    beforeEach: 'readonly',
    afterEach: 'readonly',
    beforeAll: 'readonly',
    afterAll: 'readonly',
    vi: 'readonly',
};

export default [
    {
        ignores: [
            'dist/**',
            'packages/*/dist/**',
            'benchmarks/**',
            'coverage/**',
            'node_modules/**',
        ],
    },
    {
        ...js.configs.recommended,
        files: ['**/*.{js,jsx,mjs,cjs}'],
        languageOptions: {
            globals: {
                ...globals.node,
            },
        },
    },
    {
        files: ['**/*.{ts,tsx}'],
        languageOptions: {
            parser: tsParser,
            sourceType: 'module',
            parserOptions: {
                ecmaVersion: 'latest',
            },
            globals: {
                ...globals.node,
                ...vitestGlobals,
            },
        },
        plugins: {
            '@typescript-eslint': tsPlugin,
            sonarjs,
        },
        rules: {
            ...tsPlugin.configs.recommended.rules,
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': ['error', { args: 'none' }],
            '@typescript-eslint/ban-ts-comment': 'off',
            'no-prototype-builtins': 'off',
            '@typescript-eslint/no-empty-function': 'off',
            'sonarjs/cognitive-complexity': ['error', 10],
        },
    },
    {
        files: [
            '**/*.test.ts',
            '**/*.spec.ts',
            'test-utils/**/*.ts',
            '__mocks__/**/*.ts',
            'vitest.setup.ts',
        ],
        rules: {
            'sonarjs/cognitive-complexity': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-non-null-assertion': 'off',
        },
    },
    {
        files: ['**/*.d.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },
];
