// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';

import { cpuPercent, memoryPercent, networkRates } from '../../../src/core/metrics.js';
import type { Sample } from '../../../src/core/metrics.js';
import type { InstanceState } from '../../../src/core/incus/models.js';

const SECOND_MS = 1000;
const STARTED = 1_700_000_000_000;

function state(overrides: Partial<InstanceState> = {}): InstanceState {
    return {
        cpuUsageNs: 0,
        cpuAllocatedNsPerSecond: 2_000_000_000,
        memoryUsageBytes: 0,
        memoryTotalBytes: 1000,
        rxBytes: 0,
        txBytes: 0,
        processes: 1,
        startedAtMs: STARTED,
        primaryAddress: null,
        ...overrides,
    };
}

function sample(atMs: number, overrides: Partial<InstanceState> = {}): Sample {
    return { atMs, state: state(overrides) };
}

describe('cpuPercent', () => {
    it('divides the used CPU time by the time available across all allocated CPUs', () => {
        // 0.4 s used over 2 s on 2 CPUs (4 s available) is 10 %.
        const previous = sample(0, { cpuUsageNs: 1_000_000_000 });
        const current = sample(2 * SECOND_MS, { cpuUsageNs: 1_400_000_000 });
        expect(cpuPercent(previous, current)).toBeCloseTo(10);
    });

    it.each([
        ['one CPU fully used', 1_000_000_000, 1_000_000_000, 1000, 100],
        ['idle', 1_000_000_000, 0, 1000, 0],
        ['half of one CPU', 1_000_000_000, 500_000_000, 1000, 50],
        ['a longer interval', 1_000_000_000, 1_000_000_000, 4000, 25],
    ])('%s', (_name, allocated, deltaNs, deltaMs, expected) => {
        const previous = sample(0, { cpuAllocatedNsPerSecond: allocated, cpuUsageNs: 100 });
        const current = sample(deltaMs, {
            cpuAllocatedNsPerSecond: allocated,
            cpuUsageNs: 100 + deltaNs,
        });
        expect(cpuPercent(previous, current)).toBeCloseTo(expected);
    });

    it('clamps to 100 when usage exceeds the allocation', () => {
        const previous = sample(0, { cpuUsageNs: 0 });
        const current = sample(SECOND_MS, { cpuUsageNs: 5_000_000_000 });
        expect(cpuPercent(previous, current)).toBe(100);
    });

    it('is unknown for the first sample', () => {
        expect(cpuPercent(undefined, sample(0))).toBeNull();
    });

    it.each([
        ['time did not advance', 1000, 1000],
        ['time went backwards', 1000, 500],
    ])('is unknown when %s', (_name, previousAt, currentAt) => {
        expect(cpuPercent(sample(previousAt), sample(currentAt, { cpuUsageNs: 10 }))).toBeNull();
    });

    it.each([0, -1])('is unknown when the allocation is %i', allocated => {
        const previous = sample(0, { cpuAllocatedNsPerSecond: allocated });
        const current = sample(SECOND_MS, { cpuAllocatedNsPerSecond: allocated, cpuUsageNs: 10 });
        expect(cpuPercent(previous, current)).toBeNull();
    });

    it('is unknown when the usage counter went down', () => {
        const previous = sample(0, { cpuUsageNs: 500 });
        const current = sample(SECOND_MS, { cpuUsageNs: 100 });
        expect(cpuPercent(previous, current)).toBeNull();
    });

    it('is unknown when the instance restarted between samples', () => {
        const previous = sample(0, { cpuUsageNs: 100 });
        const current = sample(SECOND_MS, { cpuUsageNs: 200, startedAtMs: STARTED + 5000 });
        expect(cpuPercent(previous, current)).toBeNull();
    });

    it('is a number when neither sample has a start time and usage advances', () => {
        const previous = sample(0, { startedAtMs: null, cpuUsageNs: 0 });
        const current = sample(SECOND_MS, { startedAtMs: null, cpuUsageNs: 1_000_000_000 });
        expect(cpuPercent(previous, current)).toBeCloseTo(50);
    });

    it.each([
        ['gained', null, STARTED],
        ['lost', STARTED, null],
    ])('is unknown when the start time was %s between samples', (_name, before, after) => {
        const previous = sample(0, { startedAtMs: before, cpuUsageNs: 0 });
        const current = sample(SECOND_MS, { startedAtMs: after, cpuUsageNs: 100 });
        expect(cpuPercent(previous, current)).toBeNull();
    });
});

describe('memoryPercent', () => {
    it.each([
        ['empty', 0, 1000, 0],
        ['a quarter', 250, 1000, 25],
        ['all of it', 1000, 1000, 100],
        ['more than the limit', 1500, 1000, 100],
    ])('%s', (_name, usage, total, expected) => {
        expect(
            memoryPercent(state({ memoryUsageBytes: usage, memoryTotalBytes: total })),
        ).toBeCloseTo(expected);
    });

    it.each([0, -5])('is unknown when the total is %i', total => {
        expect(memoryPercent(state({ memoryUsageBytes: 10, memoryTotalBytes: total }))).toBeNull();
    });
});

describe('networkRates', () => {
    it('is bytes per second received and sent between two samples', () => {
        const previous = sample(0, { rxBytes: 1000, txBytes: 500 });
        const current = sample(2 * SECOND_MS, { rxBytes: 5000, txBytes: 1500 });
        expect(networkRates(previous, current)).toStrictEqual({
            rxBytesPerSecond: 2000,
            txBytesPerSecond: 500,
        });
    });

    it('keeps fractional rates', () => {
        const rates = networkRates(sample(0), sample(3 * SECOND_MS, { rxBytes: 1, txBytes: 2 }));
        expect(rates?.rxBytesPerSecond).toBeCloseTo(1 / 3);
        expect(rates?.txBytesPerSecond).toBeCloseTo(2 / 3);
    });

    it('is zero when counters did not move', () => {
        expect(
            networkRates(sample(0, { rxBytes: 7 }), sample(SECOND_MS, { rxBytes: 7 })),
        ).toStrictEqual({
            rxBytesPerSecond: 0,
            txBytesPerSecond: 0,
        });
    });

    it('is unknown for the first sample', () => {
        expect(networkRates(undefined, sample(0))).toBeNull();
    });

    it.each([
        ['time did not advance', 1000, 1000],
        ['time went backwards', 1000, 500],
    ])('is unknown when %s', (_name, previousAt, currentAt) => {
        expect(
            networkRates(sample(previousAt), sample(currentAt, { rxBytes: 10, txBytes: 10 })),
        ).toBeNull();
    });

    it('is unknown when the instance restarted between samples', () => {
        const current = sample(SECOND_MS, { rxBytes: 10, txBytes: 10, startedAtMs: STARTED + 1 });
        expect(networkRates(sample(0), current)).toBeNull();
    });

    it.each([
        ['received', { rxBytes: 10, txBytes: 900 }],
        ['sent', { rxBytes: 900, txBytes: 10 }],
    ])('is unknown when the %s counter went down', (_name, now) => {
        const previous = sample(0, { rxBytes: 500, txBytes: 500 });
        expect(networkRates(previous, sample(SECOND_MS, now))).toBeNull();
    });
});
