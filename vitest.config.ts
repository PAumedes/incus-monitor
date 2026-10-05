import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['tests/unit/**/*.test.ts'],
        environment: 'node',
        // Worker threads, not forked processes: forks cannot be signalled in unprivileged containers.
        pool: 'threads',
        passWithNoTests: false,
        restoreMocks: true,
        coverage: {
            provider: 'v8',
            include: ['src/core/**/*.ts'],
            reporter: ['text', 'cobertura', 'html'],
            reportsDirectory: 'build/coverage',
            thresholds: {
                lines: 95,
                functions: 95,
                statements: 95,
                branches: 95,
            },
        },
        reporters: process.env['CI'] ? ['default', 'junit'] : ['default'],
        outputFile: { junit: 'build/junit.xml' },
    },
});
