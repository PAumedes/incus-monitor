// SPDX-License-Identifier: GPL-2.0-or-later
import { instanceKey, type InstanceRef } from './incus/models.js';
import { cpuPercent, networkRates, type NetworkRates, type Sample } from './metrics.js';
import type { Snapshot } from './monitor.js';

export interface LiveRates {
    readonly cpuPercent: number | null;
    readonly network: NetworkRates | null;
}

export const NO_RATES: LiveRates = { cpuPercent: null, network: null };

// The string key stays private: callers identify an instance by its reference.
interface Window {
    readonly previous: Sample | undefined;
    readonly current: Sample;
}

/**
 * Keeps the last two measurements per instance, so rates can be derived at presentation time.
 * Only a `ready` snapshot is a new measurement, and one instant is recorded once so that
 * presenting the same snapshot again does not erase the rates.
 *
 * `record(snapshot)` must run before `present(snapshot)`, so the rates the presenter reads
 * already include that snapshot.
 */
export class Sampler {
    #windows = new Map<string, Window>();
    #lastAtMs = Number.NEGATIVE_INFINITY;

    record(snapshot: Snapshot): void {
        if (snapshot.kind !== 'ready' || snapshot.atMs <= this.#lastAtMs) return;
        this.#lastAtMs = snapshot.atMs;
        // Rebuilt from the snapshot, so an instance that vanished loses its history and a
        // reused name starts clean.
        const next = new Map<string, Window>();
        for (const instance of snapshot.instances) {
            if (instance.state === null) continue;
            const key = instanceKey(instance);
            const current: Sample = { atMs: snapshot.atMs, state: instance.state };
            next.set(key, { previous: this.#windows.get(key)?.current, current });
        }
        this.#windows = next;
    }

    rates(ref: InstanceRef): LiveRates {
        const window = this.#windows.get(instanceKey(ref));
        if (window === undefined) return NO_RATES;
        return {
            cpuPercent: cpuPercent(window.previous, window.current),
            network: networkRates(window.previous, window.current),
        };
    }
}
