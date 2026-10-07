// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';

import type { Instance, InstanceState } from '../../../src/core/incus/models.js';
import type { Snapshot } from '../../../src/core/monitor.js';
import { NO_RATES, Sampler } from '../../../src/core/sampler.js';

const STARTED_AT_MS = Date.parse('2026-10-05T00:54:39.144Z');
const WEB = { project: 'default', name: 'web01' };
const LAB = { project: 'lab', name: 'web01' };

const BASE_STATE: InstanceState = {
    cpuUsageNs: 4_020_256_000,
    cpuAllocatedNsPerSecond: 4_000_000_000,
    memoryUsageBytes: 246_255_616,
    memoryTotalBytes: 2_000_000_000,
    rxBytes: 20_513,
    txBytes: 766,
    processes: 204,
    startedAtMs: STARTED_AT_MS,
    primaryAddress: '10.0.3.15',
    disk: null,
};

function running(
    cpuUsageNs: number,
    rxBytes: number,
    over: Partial<InstanceState> = {},
    ref = WEB,
): Instance {
    return {
        ...ref,
        type: 'container',
        status: 'running',
        state: { ...BASE_STATE, cpuUsageNs, rxBytes, txBytes: 0, ...over },
    };
}

const at = (atMs: number, ...instances: Instance[]): Snapshot => ({
    kind: 'ready',
    instances,
    atMs,
});

describe('Sampler', () => {
    it('has no rates for an instance it never saw', () => {
        expect(new Sampler().rates(WEB)).toEqual(NO_RATES);
    });

    it('has no rates after a single sample', () => {
        const sampler = new Sampler();
        sampler.record(at(0, running(0, 0)));
        expect(sampler.rates(WEB)).toEqual(NO_RATES);
    });

    it('has no rates for an instance listed without state', () => {
        const sampler = new Sampler();
        const stateless: Instance = { ...WEB, type: 'container', status: 'stopped', state: null };
        sampler.record(at(0, stateless));
        sampler.record(at(1000, stateless));
        expect(sampler.rates(WEB)).toEqual(NO_RATES);
    });

    it('derives CPU percent and network rates from the last two samples', () => {
        const sampler = new Sampler();
        sampler.record(at(0, running(1_000_000_000, 0)));
        sampler.record(at(1000, running(1_160_000_000, 12_000)));
        const rates = sampler.rates(WEB);
        expect(rates.cpuPercent).toBeCloseTo(4);
        expect(rates.network).toEqual({ rxBytesPerSecond: 12_000, txBytesPerSecond: 0 });
    });

    it('has no CPU percent while usage is not available, but keeps network rates and other rows', () => {
        const sampler = new Sampler();
        const vm = { project: 'default', name: 'vm1' };
        const unavailable = (rx: number): Instance =>
            running(-1, rx, { cpuAllocatedNsPerSecond: 2_000_000_000 }, vm);
        sampler.record(at(0, running(1_000_000_000, 0), unavailable(0)));
        sampler.record(at(1000, running(1_160_000_000, 0), unavailable(500)));
        expect(sampler.rates(vm)).toEqual({
            cpuPercent: null,
            network: { rxBytesPerSecond: 500, txBytesPerSecond: 0 },
        });
        expect(sampler.rates(WEB).cpuPercent).toBeCloseTo(4);
    });

    it('ignores a repeated snapshot of the same instant, so presenting twice is stable', () => {
        const sampler = new Sampler();
        sampler.record(at(0, running(1_000_000_000, 0)));
        sampler.record(at(1000, running(1_160_000_000, 12_000)));
        sampler.record(at(1000, running(1_160_000_000, 12_000)));
        expect(sampler.rates(WEB).cpuPercent).toBeCloseTo(4);
    });

    it('ignores snapshots that carry no new measurement', () => {
        const sampler = new Sampler();
        sampler.record(at(0, running(1_000_000_000, 0)));
        sampler.record(at(1000, running(1_160_000_000, 12_000)));
        sampler.record({ kind: 'refreshing', previous: [running(0, 0)] });
        sampler.record({ kind: 'connecting' });
        expect(sampler.rates(WEB).cpuPercent).toBeCloseTo(4);
    });

    it('has no rates across a restart', () => {
        const sampler = new Sampler();
        sampler.record(at(0, running(1_000_000_000, 0)));
        sampler.record(at(1000, running(5, 5, { startedAtMs: STARTED_AT_MS + 500 })));
        expect(sampler.rates(WEB)).toEqual(NO_RATES);
    });

    it('forgets an instance that disappeared, so a reused name starts clean', () => {
        const sampler = new Sampler();
        sampler.record(at(0, running(1_000_000_000, 0)));
        sampler.record(at(1000));
        sampler.record(at(2000, running(2_000_000_000, 0)));
        expect(sampler.rates(WEB)).toEqual(NO_RATES);
    });

    it('keeps separate samples per project and name', () => {
        const sampler = new Sampler();
        sampler.record(at(0, running(1_000_000_000, 0), running(4_020_256_000, 0, {}, LAB)));
        sampler.record(at(1000, running(1_160_000_000, 0), running(4_020_256_000, 0, {}, LAB)));
        expect(sampler.rates(WEB).cpuPercent).toBeCloseTo(4);
        expect(sampler.rates(LAB).cpuPercent).toBe(0);
    });
});
