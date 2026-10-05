// SPDX-License-Identifier: GPL-2.0-or-later
import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const SHELL_ONLY = [
    'gi://St',
    'gi://Clutter',
    'gi://Meta',
    'gi://Shell',
    'gi://Mtk',
    'resource:///org/gnome/shell/*',
];
const GTK_ONLY = ['gi://Gtk', 'gi://Gdk', 'gi://Adw', 'resource:///org/gnome/Shell/Extensions/*'];

export default tseslint.config(
    { ignores: ['dist/', 'build/', 'node_modules/', 'scripts/*.py'] },

    js.configs.recommended,
    ...[...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked].map(
        config => ({
            ...config,
            files: ['**/*.ts'],
        }),
    ),
    {
        files: ['**/*.ts'],
        languageOptions: {
            parserOptions: {
                project: ['./tsconfig.json', './tsconfig.tests.json', './tsconfig.gjs.json'],
                tsconfigRootDir: import.meta.dirname,
            },
        },
        rules: {
            eqeqeq: ['error', 'always'],
            'no-console': ['error', { allow: ['warn', 'error'] }],
            'prefer-const': 'error',
            'no-restricted-syntax': [
                'error',
                {
                    selector: 'TSEnumDeclaration',
                    message: 'Use a union of string literals instead of enum.',
                },
            ],
            '@typescript-eslint/explicit-module-boundary-types': 'error',
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/switch-exhaustiveness-check': 'error',
            '@typescript-eslint/no-floating-promises': 'error',
            '@typescript-eslint/naming-convention': [
                'error',
                { selector: 'default', format: ['camelCase'], leadingUnderscore: 'allow' },
                { selector: 'import', format: ['camelCase', 'PascalCase'] },
                {
                    selector: 'variable',
                    modifiers: ['const', 'global'],
                    format: ['camelCase', 'UPPER_CASE', 'PascalCase'],
                },
                { selector: 'typeLike', format: ['PascalCase'] },
                { selector: 'objectLiteralProperty', format: null },
                { selector: 'typeProperty', format: null },
            ],
        },
    },

    // Architecture boundaries (docs/ARCHITECTURE.md). core/ is pure and runs under Node.
    {
        files: ['src/core/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['gi://*', 'resource://*'],
                            caseSensitive: true,
                            message: 'core/ must stay platform-agnostic.',
                        },
                        {
                            group: ['**/adapters/**', '**/ui/**'],
                            message: 'core/ must not depend on outer layers.',
                        },
                    ],
                },
            ],
            'no-restricted-globals': [
                'error',
                'imports',
                'global',
                'log',
                'logError',
                'print',
                'printerr',
            ],
        },
    },
    {
        files: ['src/adapters/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        { group: ['**/ui/**'], message: 'adapters/ must not depend on ui/.' },
                    ],
                },
            ],
        },
    },
    {
        files: ['src/ui/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: ['**/adapters/**'],
                            message: 'ui/ receives adapters via the composition root.',
                        },
                        {
                            group: GTK_ONLY,
                            caseSensitive: true,
                            message: 'GTK libraries must not be imported in the shell process.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ['src/extension.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: GTK_ONLY,
                            caseSensitive: true,
                            message: 'GTK libraries must not be imported in the shell process.',
                        },
                    ],
                },
            ],
        },
    },
    {
        files: ['src/prefs.ts', 'src/prefs/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: [
                        {
                            group: SHELL_ONLY,
                            caseSensitive: true,
                            message: 'Shell libraries must not be imported in preferences.',
                        },
                        { group: ['**/ui/**'], message: 'prefs must not import shell UI.' },
                    ],
                },
            ],
        },
    },

    {
        files: ['tests/unit/**/*.ts', 'vitest.config.ts'],
        languageOptions: { globals: globals.node },
        rules: {
            '@typescript-eslint/no-non-null-assertion': 'off',
        },
    },
    {
        files: ['eslint.config.js'],
        languageOptions: { globals: globals.node },
    },

    prettier,
);
