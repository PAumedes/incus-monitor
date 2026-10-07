// SPDX-License-Identifier: GPL-2.0-or-later
import GLib from 'gi://GLib';

import type { Clock } from '../core/ports.js';
import { clampDelayMs } from './glib-delay.js';

interface Timer {
    live: boolean;
    readonly id: number;
}

/** Clock over GLib main-loop timers. Every pending source is tracked so dispose() removes them. */
export class GLibClock implements Clock {
    readonly #pending = new Set<Timer>();
    #disposed = false;

    setTimeout(ms: number, callback: () => void): () => void {
        if (this.#disposed) return () => undefined;
        // Source IDs are reused once a source is gone, so liveness is tracked per timer rather
        // than by looking the ID up: a stale cancel must never remove a newer timer. The wrapper
        // returns GLib.SOURCE_REMOVE so the source fires only once.
        const delay = clampDelayMs(ms);
        const timer: Timer = {
            live: true,
            id: GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this.#retire(timer, false);
                callback();
                return GLib.SOURCE_REMOVE;
            }),
        };
        this.#pending.add(timer);
        return () => {
            this.#retire(timer, true);
        };
    }

    /** Test seam: timers scheduled and neither fired nor cancelled. */
    get pendingCount(): number {
        return this.#pending.size;
    }

    now(): number {
        return GLib.get_monotonic_time() / 1000;
    }

    dispose(): void {
        this.#disposed = true;
        for (const timer of [...this.#pending]) this.#retire(timer, true);
    }

    #retire(timer: Timer, removeSource: boolean): void {
        if (!timer.live) return;
        timer.live = false;
        this.#pending.delete(timer);
        if (removeSource) GLib.Source.remove(timer.id);
    }
}
