// SPDX-License-Identifier: GPL-2.0-or-later
import type { InstanceState } from './incus/models.js';

export interface Sample {
    readonly atMs: number;
    readonly state: InstanceState;
}

export interface NetworkRates {
    readonly rxBytesPerSecond: number;
    readonly txBytesPerSecond: number;
}

const MS_PER_SECOND = 1000;

function clampPercent(value: number): number {
    return Math.min(100, Math.max(0, value));
}

/**
 * Counters only make sense between two samples of the same run: a restart resets them, and a
 * clock that did not advance has no rate. Returns the elapsed seconds, or null when unusable.
 */
function comparableSeconds(previous: Sample, current: Sample): number | null {
    // Two null start times count as the same run: only stopped instances lack one.
    if (previous.state.startedAtMs !== current.state.startedAtMs) return null;
    const seconds = (current.atMs - previous.atMs) / MS_PER_SECOND;
    return seconds > 0 ? seconds : null;
}

export function cpuPercent(previous: Sample | undefined, current: Sample): number | null {
    if (previous === undefined) return null;
    if (previous.state.cpuUsageNs < 0 || current.state.cpuUsageNs < 0) return null;
    const seconds = comparableSeconds(previous, current);
    if (seconds === null) return null;
    const allocated = current.state.cpuAllocatedNsPerSecond;
    const usedNs = current.state.cpuUsageNs - previous.state.cpuUsageNs;
    if (allocated <= 0 || usedNs < 0) return null;
    return clampPercent((usedNs / (seconds * allocated)) * 100);
}

export function memoryPercent(state: InstanceState): number | null {
    if (state.memoryTotalBytes <= 0) return null;
    return clampPercent((state.memoryUsageBytes / state.memoryTotalBytes) * 100);
}

export function networkRates(previous: Sample | undefined, current: Sample): NetworkRates | null {
    if (previous === undefined) return null;
    const seconds = comparableSeconds(previous, current);
    if (seconds === null) return null;
    const rx = current.state.rxBytes - previous.state.rxBytes;
    const tx = current.state.txBytes - previous.state.txBytes;
    if (rx < 0 || tx < 0) return null;
    return { rxBytesPerSecond: rx / seconds, txBytesPerSecond: tx / seconds };
}
