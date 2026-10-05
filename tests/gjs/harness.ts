// SPDX-License-Identifier: GPL-2.0-or-later
// Minimal test harness for code that needs a real GLib main loop (adapters/).
// Unit tests for core/ live in tests/unit and run under Vitest instead.

type TestFn = () => void | Promise<void>;

interface TestCase {
    readonly name: string;
    readonly fn: TestFn;
}

const registry: TestCase[] = [];

export function test(name: string, fn: TestFn): void {
    registry.push({ name, fn });
}

export class AssertionError extends Error {
    override name = 'AssertionError';
}

function show(value: unknown): string {
    return value === undefined ? 'undefined' : JSON.stringify(value);
}

export const assert = {
    ok(value: unknown, message = `expected truthy, got ${show(value)}`): asserts value {
        if (!value) throw new AssertionError(message);
    },

    equal<T>(actual: T, expected: T, message?: string): void {
        if (!Object.is(actual, expected))
            throw new AssertionError(message ?? `expected ${show(expected)}, got ${show(actual)}`);
    },

    deepEqual(actual: unknown, expected: unknown, message?: string): void {
        if (show(actual) !== show(expected))
            throw new AssertionError(message ?? `expected ${show(expected)}, got ${show(actual)}`);
    },

    async rejects(
        promise: Promise<unknown>,
        predicate: (error: unknown) => boolean,
    ): Promise<void> {
        try {
            await promise;
        } catch (error) {
            if (!predicate(error))
                throw new AssertionError(`rejected with unexpected error: ${String(error)}`);
            return;
        }
        throw new AssertionError('expected promise to reject');
    },
};

/** Runs every registered test sequentially and returns the number of failures. */
export async function runRegistered(): Promise<number> {
    let failures = 0;
    for (const { name, fn } of registry) {
        try {
            await fn();
            print(`ok - ${name}`);
        } catch (error) {
            failures++;
            print(`not ok - ${name}`);
            printerr(error instanceof Error ? (error.stack ?? error.message) : String(error));
        }
    }
    print(`# ${String(registry.length - failures)}/${String(registry.length)} passed`);
    return failures;
}
