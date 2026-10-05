// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';

import { CancelSource } from '../../../src/core/cancel.js';

describe('CancelSource', () => {
    it('starts uncancelled', () => {
        expect(new CancelSource().signal.cancelled).toBe(false);
    });

    it('marks the signal cancelled after cancel()', () => {
        const source = new CancelSource();
        source.cancel();
        expect(source.signal.cancelled).toBe(true);
    });

    it('runs callbacks synchronously in registration order', () => {
        const source = new CancelSource();
        const order: number[] = [];
        source.signal.onCancel(() => {
            order.push(1);
        });
        source.signal.onCancel(() => {
            order.push(2);
        });
        source.cancel();
        expect(order).toStrictEqual([1, 2]);
    });

    it('runs nothing on a second cancel()', () => {
        const source = new CancelSource();
        let runs = 0;
        source.signal.onCancel(() => {
            runs++;
        });
        source.cancel();
        source.cancel();
        expect(runs).toBe(1);
    });

    it('runs a callback registered after cancellation immediately', () => {
        const source = new CancelSource();
        source.cancel();
        let runs = 0;
        source.signal.onCancel(() => {
            runs++;
        });
        expect(runs).toBe(1);
    });

    it('returns a no-op unsubscribe for a callback registered after cancellation', () => {
        const source = new CancelSource();
        source.cancel();
        const unsubscribe = source.signal.onCancel(() => undefined);
        expect(unsubscribe).not.toThrow();
    });

    it('skips a callback that was unsubscribed before cancel()', () => {
        const source = new CancelSource();
        let runs = 0;
        const unsubscribe = source.signal.onCancel(() => {
            runs++;
        });
        unsubscribe();
        source.cancel();
        expect(runs).toBe(0);
    });

    it('is already cancelled when callbacks run', () => {
        const source = new CancelSource();
        let seen: boolean | undefined;
        source.signal.onCancel(() => {
            seen = source.signal.cancelled;
        });
        source.cancel();
        expect(seen).toBe(true);
    });

    it('runs a function registered twice once after one unsubscribe', () => {
        const source = new CancelSource();
        let runs = 0;
        const cb = () => {
            runs++;
        };
        const unsubscribe = source.signal.onCancel(cb);
        source.signal.onCancel(cb);
        unsubscribe();
        source.cancel();
        expect(runs).toBe(1);
    });

    it('keeps the order of the remaining callbacks after unsubscribing the middle one', () => {
        const source = new CancelSource();
        const order: string[] = [];
        source.signal.onCancel(() => {
            order.push('a');
        });
        const ub = source.signal.onCancel(() => {
            order.push('b');
        });
        source.signal.onCancel(() => {
            order.push('c');
        });
        ub();
        source.cancel();
        expect(order).toStrictEqual(['a', 'c']);
    });

    it('runs only the third callback after unsubscribing the first two in order', () => {
        const source = new CancelSource();
        const order: string[] = [];
        const ua = source.signal.onCancel(() => {
            order.push('a');
        });
        const ub = source.signal.onCancel(() => {
            order.push('b');
        });
        source.signal.onCancel(() => {
            order.push('c');
        });
        ua();
        ub();
        source.cancel();
        expect(order).toStrictEqual(['c']);
    });

    it('ignores a repeated unsubscribe', () => {
        const source = new CancelSource();
        const order: string[] = [];
        const ua = source.signal.onCancel(() => {
            order.push('a');
        });
        source.signal.onCancel(() => {
            order.push('b');
        });
        ua();
        ua();
        source.cancel();
        expect(order).toStrictEqual(['b']);
    });

    it('runs the remaining callbacks when one throws', () => {
        const source = new CancelSource();
        const failure = new Error('callback failed');
        let runs = 0;
        source.signal.onCancel(() => {
            throw failure;
        });
        source.signal.onCancel(() => {
            runs++;
        });
        expect(() => {
            source.cancel();
        }).toThrow(failure);
        expect(runs).toBe(1);
        source.cancel();
        expect(runs).toBe(1);
    });

    it('does not run a callback that an earlier callback unsubscribes during cancel()', () => {
        const source = new CancelSource();
        let ranB = false;
        let unsubscribeB: () => void = () => undefined;
        source.signal.onCancel(() => {
            unsubscribeB();
        });
        unsubscribeB = source.signal.onCancel(() => {
            ranB = true;
        });
        source.cancel();
        expect(ranB).toBe(false);
    });

    it('rethrows the first error when several callbacks throw, after running all of them', () => {
        const source = new CancelSource();
        const first = new Error('first');
        let runs = 0;
        source.signal.onCancel(() => {
            runs++;
            throw first;
        });
        source.signal.onCancel(() => {
            runs++;
            throw new Error('second');
        });
        expect(() => {
            source.cancel();
        }).toThrow(first);
        expect(runs).toBe(2);
    });

    it('still throws when a callback throws undefined', () => {
        const source = new CancelSource();
        source.signal.onCancel(() => {
            // eslint-disable-next-line @typescript-eslint/only-throw-error
            throw undefined;
        });
        let threw = false;
        try {
            source.cancel();
        } catch {
            threw = true;
        }
        expect(threw).toBe(true);
    });
});
