// SPDX-License-Identifier: GPL-2.0-or-later
import type { Clock } from '../../../src/core/ports.js';

interface Timer {
    readonly at: number;
    readonly callback: () => void;
}

/** Time moves only through `advance`, so a test never sleeps. Ties fire in creation order. */
export class FakeClock implements Clock {
    #now = 0;
    #nextId = 0;
    readonly #timers = new Map<number, Timer>();

    /** Timers that are scheduled and neither fired nor cancelled. */
    get pending(): number {
        return this.#timers.size;
    }

    now(): number {
        return this.#now;
    }

    setTimeout(ms: number, callback: () => void): () => void {
        const id = this.#nextId++;
        this.#timers.set(id, { at: this.#now + ms, callback });
        return () => {
            this.#timers.delete(id);
        };
    }

    /** Fires every timer due within `ms`, including ones scheduled by a callback. */
    advance(ms: number): void {
        const target = this.#now + ms;
        for (;;) {
            let next: [number, Timer] | undefined;
            for (const entry of this.#timers) {
                if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) next = entry;
            }
            if (!next) break;
            this.#timers.delete(next[0]);
            this.#now = next[1].at;
            next[1].callback();
        }
        this.#now = target;
    }
}

/** Lets every promise continuation run; macrotasks are not wall-clock time. */
export const flush = (): Promise<void> => new Promise(resolve => setImmediate(resolve));
