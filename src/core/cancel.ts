// SPDX-License-Identifier: GPL-2.0-or-later

/** Read side of a cancellation. GJS has no AbortSignal, and core must not import Gio. */
export interface CancelSignal {
    readonly cancelled: boolean;
    /** Runs `callback` on cancellation (at once if already cancelled). Returns an unsubscribe. */
    onCancel(callback: () => void): () => void;
}

class Signal implements CancelSignal {
    cancelled = false;
    // Each registration is its own wrapper, so unsubscribing removes exactly one even when the
    // same callback is registered twice.
    readonly entries = new Set<() => void>();

    onCancel(callback: () => void): () => void {
        if (this.cancelled) {
            callback();
            return () => undefined;
        }
        const entry = () => {
            callback();
        };
        this.entries.add(entry);
        return () => {
            this.entries.delete(entry);
        };
    }
}

export class CancelSource {
    readonly #signal = new Signal();

    get signal(): CancelSignal {
        return this.#signal;
    }

    cancel(): void {
        const signal = this.#signal;
        if (signal.cancelled) return;
        signal.cancelled = true;
        // Set iteration is live, so a callback unsubscribed by an earlier one is skipped. One
        // failing callback must not stop the rest of a teardown, so the first error is rethrown last.
        let failure: { readonly error: unknown } | undefined;
        for (const entry of signal.entries) {
            signal.entries.delete(entry);
            try {
                entry();
            } catch (error) {
                failure ??= { error };
            }
        }
        if (failure) throw failure.error;
    }
}

// A function call, because TypeScript keeps the narrowed `false` of `signal.cancelled` across an
// await and would flag the second check as unnecessary.
export const isCancelled = (signal: CancelSignal): boolean => signal.cancelled;
