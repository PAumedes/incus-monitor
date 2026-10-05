// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { andThen, err, map, ok } from '../../../src/core/result.js';
import type { Result } from '../../../src/core/result.js';

describe('Result', () => {
    it('is a discriminated union on ok', () => {
        expectTypeOf<Result<number, string>>().toEqualTypeOf<
            | { readonly ok: true; readonly value: number }
            | { readonly ok: false; readonly error: string }
        >();
    });
});

describe('ok', () => {
    it('wraps a value as a successful result', () => {
        expect(ok(42)).toStrictEqual({ ok: true, value: 42 });
    });
});

describe('err', () => {
    it('wraps an error as a failed result', () => {
        expect(err('boom')).toStrictEqual({ ok: false, error: 'boom' });
    });
});

describe('map', () => {
    it('transforms the value of a successful result', () => {
        expect(map(ok(2), n => n * 3)).toStrictEqual(ok(6));
    });

    it('returns the same error without calling the function on a failure', () => {
        const failure: Result<number, string> = err('boom');
        const fn = vi.fn((n: number) => n + 1);

        expect(map(failure, fn)).toBe(failure);
        expect(fn).not.toHaveBeenCalled();
    });
});

describe('andThen', () => {
    const half = (n: number): Result<number, string> =>
        n % 2 === 0 ? ok(n / 2) : err(`odd: ${String(n)}`);

    it.each([
        ['returns the next result when both steps succeed', ok(4), ok(2)],
        ['returns the error of the next step when it fails', ok(3), err('odd: 3')],
    ])('%s', (_name, input: Result<number, string>, expected) => {
        expect(andThen(input, half)).toStrictEqual(expected);
    });

    it('returns the same error without calling the function on a failure', () => {
        const failure: Result<number, string> = err('boom');
        const fn = vi.fn(half);

        expect(andThen(failure, fn)).toBe(failure);
        expect(fn).not.toHaveBeenCalled();
    });
});
