// SPDX-License-Identifier: GPL-2.0-or-later

/** Failures are returned, never thrown: no exception crosses a module boundary. */
export type Result<T, E> =
    { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
    return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
    return { ok: false, error };
}

export function map<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
    return result.ok ? ok(fn(result.value)) : result;
}

export function andThen<T, U, E, F>(
    result: Result<T, E>,
    fn: (value: T) => Result<U, F>,
): Result<U, E | F> {
    return result.ok ? fn(result.value) : result;
}
