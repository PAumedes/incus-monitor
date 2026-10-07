// SPDX-License-Identifier: GPL-2.0-or-later
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { decodeInstances, decodeServer } from '../../../../src/core/incus/decode.js';
import type { Instance } from '../../../../src/core/incus/models.js';
import {
    address,
    FIXTURE_SERIES,
    instanceJson,
    nic,
    RECORDED_INSTANCES,
    readFixture,
    withNetwork,
    withState,
} from '../../builders.js';
import type { Json } from '../../builders.js';

const STARTED_AT_MS = Date.parse('2026-10-05T00:54:39.144Z');

const WEB01_STATE = {
    cpuUsageNs: 4020256000,
    cpuAllocatedNsPerSecond: 4000000000,
    memoryUsageBytes: 246255616,
    memoryTotalBytes: 31698556000,
    rxBytes: 20513,
    txBytes: 766,
    processes: 204,
    startedAtMs: STARTED_AT_MS,
    // The recorded web01 has only a global IPv6 address, which is not used as the primary one.
    primaryAddress: null,
    // The recorded web01 sits on a `dir` pool, which reports `disk: {}`.
    disk: null,
};

function decodeOne(raw: Json): Instance {
    const result = decodeInstances([raw]);
    if (!result.ok) throw new Error(`decode failed: ${JSON.stringify(result.error)}`);
    const [first] = result.value;
    if (first === undefined) throw new Error('no instance decoded');
    return first;
}

function stateOf(raw: Json): NonNullable<Instance['state']> {
    const { state } = decodeOne(raw);
    if (state === null) throw new Error('state expected');
    return state;
}

function decodeError(metadata: unknown): { kind: string; path: string } {
    const result = decodeInstances(metadata);
    if (result.ok) throw new Error('expected a decode error');
    if (result.error.kind !== 'decode')
        throw new Error(`unexpected error kind ${result.error.kind}`);
    return result.error;
}

describe('decodeServer', () => {
    it('decodes the recorded server fixture', () => {
        const result = decodeServer(readFixture('6.0', 'server').metadata);
        expect(result.ok && result.value.version).toBe('6.0.5');
        expect(result.ok && result.value.apiExtensions.size).toBe(466);
        expect(result.ok && result.value.apiExtensions.has('etag')).toBe(true);
    });

    it('ignores unknown fields', () => {
        const metadata = {
            environment: { server_version: '7.0', extra: 1 },
            api_extensions: [],
            x: {},
        };
        const result = decodeServer(metadata);
        expect(result).toStrictEqual({
            ok: true,
            value: { version: '7.0', apiExtensions: new Set<string>() },
        });
    });

    it('accepts a version of exactly 32 characters', () => {
        const version = '1'.repeat(32);
        const result = decodeServer({
            environment: { server_version: version },
            api_extensions: [],
        });
        expect(result.ok && result.value.version).toBe(version);
    });

    it.each<[string, unknown, string]>([
        ['metadata is null', null, 'metadata'],
        ['metadata is an array', [], 'metadata'],
        [
            'version is missing',
            { environment: {}, api_extensions: [] },
            'metadata.environment.server_version',
        ],
        [
            'version is not a string',
            { environment: { server_version: 6 }, api_extensions: [] },
            'metadata.environment.server_version',
        ],
        [
            'version contains a newline',
            { environment: { server_version: '6.0\n5' }, api_extensions: [] },
            'metadata.environment.server_version',
        ],
        [
            'version contains an escape character',
            { environment: { server_version: '6.0\x1b[0m' }, api_extensions: [] },
            'metadata.environment.server_version',
        ],
        ['environment is missing', { api_extensions: [] }, 'metadata.environment'],
        [
            'environment is not an object',
            { environment: 'x', api_extensions: [] },
            'metadata.environment',
        ],
        [
            'version is longer than 32 characters',
            { environment: { server_version: '1'.repeat(33) }, api_extensions: [] },
            'metadata.environment.server_version',
        ],
        [
            'api_extensions is missing',
            { environment: { server_version: '6.0.5' } },
            'metadata.api_extensions',
        ],
        [
            'api_extensions is not an array',
            { environment: { server_version: '6.0.5' }, api_extensions: 'etag' },
            'metadata.api_extensions',
        ],
        [
            'an api extension is not a string',
            { environment: { server_version: '6.0.5' }, api_extensions: ['etag', 3] },
            'metadata.api_extensions[1]',
        ],
    ])('reports a decode error when %s', (_label, metadata, path) => {
        const result = decodeServer(metadata);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.error.kind).toBe('decode');
        expect(!result.ok && result.error.kind === 'decode' && result.error.path).toBe(path);
    });
});

describe('recorded fixtures of every series', () => {
    it('has at least one series', () => {
        expect(FIXTURE_SERIES.length).toBeGreaterThan(0);
    });

    describe.each(FIXTURE_SERIES)('series %s', series => {
        const has = (name: string): boolean =>
            existsSync(new URL(`../../../fixtures/incus/${series}/${name}.json`, import.meta.url));

        it.skipIf(!has('server'))('decodes server.json', () => {
            expect(decodeServer(readFixture(series, 'server').metadata).ok).toBe(true);
        });

        it.each(['instances-recursion1', 'instances-recursion2'].filter(has))(
            'decodes %s.json',
            name => {
                expect(decodeInstances(readFixture(series, name).metadata).ok).toBe(true);
            },
        );
    });
});

describe.each(FIXTURE_SERIES)('decodeInstances: recorded %s fixtures', series => {
    it.each(['instances-recursion1', 'instances-recursion2'])(
        'yields the recorded names, types and statuses from %s',
        name => {
            const result = decodeInstances(readFixture(series, name).metadata);
            expect(result.ok && result.value.map(i => [i.name, i.type, i.status])).toStrictEqual(
                RECORDED_INSTANCES[series],
            );
        },
    );
});

describe('decodeInstances: recorded fixtures', () => {
    it('decodes recursion=1 with state absent', () => {
        expect(decodeInstances(readFixture('6.0', 'instances-recursion1').metadata)).toStrictEqual({
            ok: true,
            value: [
                {
                    project: 'user-1000',
                    name: 'web01',
                    type: 'container',
                    status: 'running',
                    state: null,
                    forwards: [],
                },
            ],
        });
    });

    it('decodes recursion=2 with exact state values', () => {
        expect(decodeInstances(readFixture('6.0', 'instances-recursion2').metadata)).toStrictEqual({
            ok: true,
            value: [
                {
                    project: 'user-1000',
                    name: 'web01',
                    type: 'container',
                    status: 'running',
                    state: WEB01_STATE,
                    forwards: [],
                },
            ],
        });
    });

    it('decodes an empty list to an empty array', () => {
        expect(decodeInstances([])).toStrictEqual({ ok: true, value: [] });
    });

    it('decodes many instances in order', () => {
        const names = ['a', 'b', 'c'];
        const result = decodeInstances(names.map(name => instanceJson({ name })));
        expect(result.ok && result.value.map(i => i.name)).toStrictEqual(names);
    });

    it('ignores unknown fields on the instance and its state', () => {
        const raw = withState({ surprise: { deep: [1] } });
        raw['another'] = 'x';
        expect(stateOf(raw)).toStrictEqual(WEB01_STATE);
    });
});

describe('decodeInstances: status', () => {
    it.each([
        [103, 'running'],
        [113, 'running'],
        [102, 'stopped'],
        [110, 'frozen'],
        [112, 'error'],
        [101, 'busy'],
        [104, 'busy'],
        [105, 'busy'],
        [106, 'busy'],
        [107, 'busy'],
        [108, 'busy'],
        [109, 'busy'],
        [111, 'busy'],
        [100, 'unknown'],
        [200, 'unknown'],
        [0, 'unknown'],
    ])('maps status_code %i to %s', (code, status) => {
        expect(decodeOne(instanceJson({ status_code: code })).status).toBe(status);
    });

    it.each<[string, unknown]>([
        ['a string', '103'],
        ['a fraction', 103.5],
        ['null', null],
        ['absent', undefined],
    ])('rejects a status_code that is %s', (_label, code) => {
        expect(decodeError([instanceJson({ status_code: code })])).toStrictEqual({
            kind: 'decode',
            path: 'metadata[0].status_code',
            detail: expect.any(String) as unknown,
        });
    });
});

describe('decodeInstances: identity', () => {
    it.each(['a', 'web01', 'a-b', 'A1', 'a'.repeat(63)])('accepts the instance name %j', name => {
        expect(decodeOne(instanceJson({ name })).name).toBe(name);
    });

    it.each(['', '1abc', '-abc', 'abc-', 'a_b', 'a.b', 'a b', 'a/b', 'a'.repeat(64), 'é'])(
        'rejects the instance name %j',
        name => {
            expect(decodeError([instanceJson({ name })]).path).toBe('metadata[0].name');
        },
    );

    it.each([
        'default',
        'user-1000',
        'a',
        '7',
        'proj.v2',
        'team:dev',
        'a-ünï-z',
        'a'.repeat(64),
        'a' + 'é'.repeat(31) + 'z',
    ])('accepts the project %j', project => {
        expect(decodeOne(instanceJson({ project })).project).toBe(project);
    });

    it.each([
        '',
        '_x',
        'a_b',
        'my project',
        'a/b',
        '..',
        '.',
        '-x',
        'x-',
        'a?b',
        'a$b',
        'a+b',
        'a*b',
        "a'b",
        'a&b',
        'a"b',
        'a`b',
        'a'.repeat(65),
        'é'.repeat(33),
        'é',
        'ünïcode',
        'é'.repeat(32),
        'a' + 'é'.repeat(31) + 'zz',
        'a\u202Eb',
        'a\u0085b',
        'a\u200Bb',
        'a\uD800b',
        'a\u2028b',
        'a b',
        'a\x7fb',
        'a\nb',
        'a\x00b',
    ])('rejects the project %j', project => {
        expect(decodeError([instanceJson({ project })]).path).toBe('metadata[0].project');
    });

    it.each(['container', 'virtual-machine'])('accepts the type %s', type => {
        expect(decodeOne(instanceJson({ type })).type).toBe(type);
    });

    it.each<unknown>(['vm', 'Container', '', 3, null, undefined])('rejects the type %j', type => {
        expect(decodeError([instanceJson({ type })]).path).toBe('metadata[0].type');
    });

    it.each<[string, unknown, string]>([
        ['metadata is null', null, 'metadata'],
        ['metadata is an object', {}, 'metadata'],
        ['metadata is a string', 'web01', 'metadata'],
        ['an entry is null', [instanceJson(), null], 'metadata[1]'],
        ['an entry is a number', [instanceJson(), 1], 'metadata[1]'],
        ['an entry is an array', [instanceJson(), []], 'metadata[1]'],
    ])('rejects the list when %s', (_label, metadata, path) => {
        expect(decodeError(metadata)).toMatchObject({ kind: 'decode', path });
    });

    it('names the offending index when a later instance is invalid', () => {
        const error = decodeError([instanceJson(), instanceJson({ name: '9' })]);
        expect(error.path).toBe('metadata[1].name');
    });
});

describe('decodeInstances: state', () => {
    it('keeps state null when the instance has no state', () => {
        expect(decodeOne(instanceJson({ state: undefined })).state).toBeNull();
    });

    it('keeps state null when state is null', () => {
        expect(decodeOne(instanceJson({ state: null })).state).toBeNull();
    });

    it('rejects a state that is not an object', () => {
        expect(decodeError([instanceJson({ state: 'x' })]).path).toBe('metadata[0].state');
    });

    it('reads zeroes for a stopped instance that omits or nulls its pieces', () => {
        const raw = withState({
            status_code: 102,
            memory: undefined,
            cpu: null,
            network: null,
            processes: 0,
            started_at: undefined,
            pid: 0,
        });
        expect(stateOf(raw)).toStrictEqual({
            cpuUsageNs: 0,
            cpuAllocatedNsPerSecond: 0,
            memoryUsageBytes: 0,
            memoryTotalBytes: 0,
            rxBytes: 0,
            txBytes: 0,
            processes: 0,
            startedAtMs: null,
            primaryAddress: null,
            disk: null,
        });
    });

    it('reads zero for an absent field inside a present sub-object', () => {
        const state = stateOf(withState({ cpu: {}, memory: { usage: 5 } }));
        expect(state).toMatchObject({
            cpuUsageNs: 0,
            cpuAllocatedNsPerSecond: 0,
            memoryUsageBytes: 5,
            memoryTotalBytes: 0,
        });
    });

    it.each([undefined, null])('treats processes %j as not reported (-1)', processes => {
        expect(stateOf(withState({ processes })).processes).toBe(-1);
    });

    it('accepts processes of -1 as reported for a VM without an agent', () => {
        expect(stateOf(withState({ processes: -1 })).processes).toBe(-1);
    });

    it('keeps the -1 "not available" CPU usage of a VM whose agent does not report it', () => {
        // Recorded from an Alpine VM on Incus 6.0.5; a missing metric must not fail the list.
        const raw = withState({
            cpu: { usage: -1, allocated_time: 0 },
            disk: null,
            memory: { usage: 105_111_552, usage_peak: 0, total: 352_096_256 },
            network: {
                eth0: nic([address('inet', '192.0.2.9')], 'broadcast', {
                    bytes_received: 1500,
                    bytes_sent: 900,
                }),
            },
            processes: 10,
            started_at: '2026-10-06T00:31:18.305880709-03:00',
        });
        expect(stateOf(raw)).toStrictEqual({
            cpuUsageNs: -1,
            cpuAllocatedNsPerSecond: 0,
            memoryUsageBytes: 105_111_552,
            memoryTotalBytes: 352_096_256,
            rxBytes: 1500,
            txBytes: 900,
            processes: 10,
            startedAtMs: Date.parse('2026-10-06T03:31:18.305Z'),
            primaryAddress: '192.0.2.9',
            disk: null,
        });
    });

    it('still decodes the other instances of a list that has one VM without CPU usage', () => {
        const vm = instanceJson({ name: 'vm1', type: 'virtual-machine' });
        (vm['state'] as Json)['cpu'] = { usage: -1, allocated_time: 0 };
        const result = decodeInstances([instanceJson(), vm]);
        expect(result.ok && result.value.map(i => i.name)).toEqual(['web01', 'vm1']);
    });

    it('rejects a NaN CPU usage even though -1 is accepted', () => {
        const raw = instanceJson();
        raw['state'] = { ...(raw['state'] as Json), cpu: { usage: Number.NaN } };
        expect(decodeError([raw]).path).toBe('metadata[0].state.cpu.usage');
    });

    it('accepts a null disk section', () => {
        expect(stateOf(withState({ disk: null })).memoryUsageBytes).toBe(246_255_616);
    });

    describe('disk', () => {
        it('reads the root disk usage and total', () => {
            const raw = withState({ disk: { root: { usage: 52_920_320, total: 1_073_741_824 } } });
            expect(stateOf(raw).disk).toStrictEqual({
                usageBytes: 52_920_320,
                totalBytes: 1_073_741_824,
            });
        });

        it('reads a total of 0 when the root disk has no quota', () => {
            const raw = withState({ disk: { root: { usage: 5, total: 0 } } });
            expect(stateOf(raw).disk).toStrictEqual({ usageBytes: 5, totalBytes: 0 });
        });

        it('reads a total of 0 when the root disk omits it', () => {
            expect(stateOf(withState({ disk: { root: { usage: 5 } } })).disk).toStrictEqual({
                usageBytes: 5,
                totalBytes: 0,
            });
        });

        it.each<[string, unknown]>([
            ['absent', undefined],
            ['null', null],
            ['an empty map (dir pool)', {}],
            ['a map without a root entry', { data: { usage: 5, total: 0 } }],
            ['a root entry that is an empty object', { root: {} }],
            // Incus 7.0 reports -1 when it cannot measure the disk (recorded for stopped instances).
            ['a usage of -1', { root: { usage: -1, total: 0 } }],
        ])('treats a disk section that is %s as not reported', (_label, disk) => {
            expect(stateOf(withState({ disk })).disk).toBeNull();
        });

        it.each<[string, unknown]>([
            ['-1', -1],
            ['a string', '1024'],
            ['null', null],
        ])('does not validate a total of %s next to the -1 usage sentinel', (_label, total) => {
            const raw = withState({ disk: { root: { usage: -1, total } } });
            expect(stateOf(raw).disk).toBeNull();
        });

        it('reads the root entry of a map that also lists other devices', () => {
            const raw = withState({
                disk: { data: { usage: 9, total: 9 }, root: { usage: 5, total: 7 } },
            });
            expect(stateOf(raw).disk).toStrictEqual({ usageBytes: 5, totalBytes: 7 });
        });

        it.each<[string, unknown, string]>([
            ['disk is a string', 'big', 'metadata[0].state.disk'],
            ['disk is an array', [], 'metadata[0].state.disk'],
            ['root is a number', { root: 5 }, 'metadata[0].state.disk.root'],
            ['root is null', { root: null }, 'metadata[0].state.disk.root'],
            ['usage is a string', { root: { usage: '5' } }, 'metadata[0].state.disk.root.usage'],
            ['usage is a boolean', { root: { usage: true } }, 'metadata[0].state.disk.root.usage'],
            ['usage is below -1', { root: { usage: -2 } }, 'metadata[0].state.disk.root.usage'],
            ['usage is NaN', { root: { usage: Number.NaN } }, 'metadata[0].state.disk.root.usage'],
            [
                'total is a string',
                { root: { usage: 1, total: '9' } },
                'metadata[0].state.disk.root.total',
            ],
            [
                'total is negative',
                { root: { usage: 1, total: -1 } },
                'metadata[0].state.disk.root.total',
            ],
        ])('rejects state when %s', (_label, disk, path) => {
            expect(decodeError([withState({ disk })])).toMatchObject({ kind: 'decode', path });
        });
    });

    it.each<[string, Json, string]>([
        ['cpu.usage is a string', { cpu: { usage: '1' } }, 'metadata[0].state.cpu.usage'],
        [
            'cpu.usage is below the -1 sentinel',
            { cpu: { usage: -2 } },
            'metadata[0].state.cpu.usage',
        ],
        [
            'cpu.allocated_time is negative',
            { cpu: { allocated_time: -5 } },
            'metadata[0].state.cpu.allocated_time',
        ],
        [
            'memory.usage is a boolean',
            { memory: { usage: true } },
            'metadata[0].state.memory.usage',
        ],
        ['memory.total is negative', { memory: { total: -1 } }, 'metadata[0].state.memory.total'],
        ['cpu is not an object', { cpu: 5 }, 'metadata[0].state.cpu'],
        ['memory is a string', { memory: 'big' }, 'metadata[0].state.memory'],
        ['processes is below -1', { processes: -2 }, 'metadata[0].state.processes'],
        ['processes is a fraction', { processes: 1.5 }, 'metadata[0].state.processes'],
        ['processes is a string', { processes: '4' }, 'metadata[0].state.processes'],
        ['network is not an object', { network: [] }, 'metadata[0].state.network'],
        [
            'a network entry is not an object',
            { network: { eth0: 5 } },
            'metadata[0].state.network.eth0',
        ],
        [
            'counters is not an object',
            { network: { eth0: { type: 'broadcast', counters: 'x' } } },
            'metadata[0].state.network.eth0.counters',
        ],
    ])('rejects state when %s', (_label, patch, path) => {
        expect(decodeError([withState(patch)])).toMatchObject({ kind: 'decode', path });
    });

    it('rejects a network counter of the wrong type with its path', () => {
        const raw = withNetwork({
            eth0: nic([], 'broadcast', { bytes_received: 'x', bytes_sent: 1 }),
        });
        expect(decodeError([raw]).path).toBe(
            'metadata[0].state.network.eth0.counters.bytes_received',
        );
    });

    it('rejects a negative network counter', () => {
        const raw = withNetwork({
            eth0: nic([], 'broadcast', { bytes_received: 1, bytes_sent: -1 }),
        });
        expect(decodeError([raw]).path).toBe('metadata[0].state.network.eth0.counters.bytes_sent');
    });
});

describe('decodeInstances: started_at', () => {
    it.each<[string, unknown, number | null]>([
        ['an RFC 3339 timestamp with offset', '2026-10-04T21:54:39.14426688-03:00', STARTED_AT_MS],
        ['a UTC timestamp', '2026-10-05T00:54:39.144Z', STARTED_AT_MS],
        ['the year-0001 never-started value', '0001-01-01T00:00:00Z', null],
        ['null', null, null],
        ['absent', undefined, null],
    ])('maps %s', (_label, startedAt, expected) => {
        expect(stateOf(withState({ started_at: startedAt })).startedAtMs).toBe(expected);
    });

    it.each<[string, unknown]>([
        ['an unparsable string', 'yesterday'],
        ['an empty string', ''],
        ['a number', 5],
        ['an object', {}],
    ])('rejects %s with its path', (_label, startedAt) => {
        expect(decodeError([withState({ started_at: startedAt })]).path).toBe(
            'metadata[0].state.started_at',
        );
    });
});

describe('decodeInstances: hostile interface names in error paths', () => {
    const hostile = 'x'.repeat(1e6) + '\nFORGED\x1b[0m';
    // Control and format characters, line separators and (with the u flag) lone surrogates.
    const unsafeCharacters = /[\p{C}\u2028\u2029]/u;

    it.each<[string, unknown]>([
        ['an entry that is not an object', 5],
        ['counters of the wrong type', nic([], 'broadcast', { bytes_received: 'x' })],
        ['counters that are not an object', { type: 'broadcast', counters: 'x' }],
    ])('shortens and sanitises the key for %s', (_label, entry) => {
        const { path } = decodeError([withNetwork({ [hostile]: entry })]);
        expect(path.length).toBeLessThanOrEqual(200);
        expect(unsafeCharacters.test(path)).toBe(false);
    });

    it.each([
        ['C1, bidi and line-separator characters', 'x\u202E\u0085\u2028\u200B y' + 'z'.repeat(100)],
        ['an emoji run that a cut could split mid-pair', '😀'.repeat(30)],
        ['an emoji at every offset of the cut', 'a' + '😀'.repeat(30)],
    ])('leaves no unsafe code point or lone surrogate for %s', (_label, key) => {
        const { path } = decodeError([withNetwork({ [key]: 5 })]);
        expect(path.length).toBeLessThanOrEqual(200);
        expect(unsafeCharacters.test(path)).toBe(false);
    });
});

describe('decodeInstances: network totals and primary address', () => {
    const v4 = address('inet', '192.0.2.10');
    const v6 = address('inet6', '2001:db8::10');

    it('sums counters across non-loopback interfaces and skips loopback', () => {
        const raw = withNetwork({
            lo: nic([], 'loopback', { bytes_received: 1000, bytes_sent: 1000 }),
            eth0: nic([], 'broadcast', { bytes_received: 10, bytes_sent: 1 }),
            eth1: nic([], 'broadcast', { bytes_received: 20, bytes_sent: 2 }),
        });
        expect(stateOf(raw)).toMatchObject({ rxBytes: 30, txBytes: 3 });
    });

    it('excludes a loopback-typed interface with any name from the totals', () => {
        const raw = withNetwork({
            dummy0: nic([v4], 'loopback', { bytes_received: 1000, bytes_sent: 1000 }),
        });
        expect(stateOf(raw)).toMatchObject({ rxBytes: 0, txBytes: 0, primaryAddress: null });
    });

    it('counts an interface named lo that is not loopback', () => {
        const raw = withNetwork({
            lo: nic([v4], 'broadcast', { bytes_received: 4, bytes_sent: 2 }),
        });
        expect(stateOf(raw)).toMatchObject({
            rxBytes: 4,
            txBytes: 2,
            primaryAddress: '192.0.2.10',
        });
    });

    it('ignores inherited interfaces and reads own entries only', () => {
        const raw = withState({});
        const network: Json = Object.create({
            ghost: nic([address('inet', '10.9.9.9')], 'broadcast', {
                bytes_received: 99,
                bytes_sent: 99,
            }),
        }) as Json;
        network['eth0'] = nic([], 'broadcast', { bytes_received: 1, bytes_sent: 2 });
        (raw['state'] as Json)['network'] = network;
        expect(stateOf(raw)).toMatchObject({ rxBytes: 1, txBytes: 2, primaryAddress: null });
    });

    it('ignores interfaces with missing or odd address data', () => {
        const odd = [null, {}, { family: 'inet', address: '10.0.0.9' }, 7];
        const raw = withNetwork({
            a: { type: 'broadcast', counters: {} },
            b: { type: 'broadcast', addresses: null },
            c: nic(odd as Json[]),
            d: nic([v4]),
        });
        expect(stateOf(raw).primaryAddress).toBe('192.0.2.10');
    });

    it('rejects summed counters that are not finite', () => {
        const big = { bytes_received: 1e308, bytes_sent: 1 };
        const raw = withNetwork({
            eth0: nic([], 'broadcast', big),
            eth1: nic([], 'broadcast', big),
        });
        expect(decodeError([raw])).toMatchObject({
            kind: 'decode',
            path: 'metadata[0].state.network',
        });
    });

    it('ignores a global address of an unknown family', () => {
        const raw = withNetwork({ eth0: nic([address('inet7', '192.0.2.10')]) });
        expect(stateOf(raw).primaryAddress).toBeNull();
    });

    it('reads zero totals for an empty network', () => {
        expect(stateOf(withNetwork({}))).toMatchObject({
            rxBytes: 0,
            txBytes: 0,
            primaryAddress: null,
        });
    });

    it('reads zero for an interface without counters', () => {
        const raw = withNetwork({ eth0: { addresses: [v4], type: 'broadcast' } });
        expect(stateOf(raw)).toMatchObject({
            rxBytes: 0,
            txBytes: 0,
            primaryAddress: '192.0.2.10',
        });
    });

    it.each<[string, Json, string | null]>([
        ['IPv4 only', { eth0: nic([v4]) }, '192.0.2.10'],
        ['IPv6 only', { eth0: nic([v6]) }, null],
        ['dual stack, IPv6 listed first', { eth0: nic([v6, v4]) }, '192.0.2.10'],
        ['dual stack across interfaces', { eth0: nic([v6]), eth1: nic([v4]) }, '192.0.2.10'],
        [
            'several IPv4 addresses, first wins',
            { eth0: nic([address('inet', '192.0.2.11'), v4]) },
            '192.0.2.11',
        ],
        [
            'several IPv6 addresses and no IPv4',
            { eth0: nic([address('inet6', '2001:db8::11'), v6]) },
            null,
        ],
        ['loopback only', { lo: nic([address('inet', '127.0.0.1')], 'loopback') }, null],
        [
            'global address on loopback is ignored',
            { lo: nic([v4], 'loopback'), eth0: nic([v6]) },
            null,
        ],
        [
            'link and local scopes are ignored',
            {
                eth0: nic([
                    address('inet6', 'fe80::1', 'link'),
                    address('inet', '10.0.0.1', 'local'),
                ]),
            },
            null,
        ],
        ['no addresses', { eth0: nic([]) }, null],
        ['no interfaces', {}, null],
    ])('picks the primary address for %s', (_label, network, expected) => {
        expect(stateOf(withNetwork(network)).primaryAddress).toBe(expected);
    });

    it.each([
        '',
        '1',
        'x'.repeat(10),
        '192.0.2.10/24',
        '1'.repeat(46),
        '<b>1.2.3.4</b>',
        'fe80::1%eth0',
    ])('ignores the malformed address %j without failing', bad => {
        const raw = withNetwork({ eth0: nic([address('inet', bad), v4]) });
        expect(stateOf(raw).primaryAddress).toBe('192.0.2.10');
    });

    it('accepts an IPv4 address given in the 45 character IPv4-mapped form', () => {
        const max = '0000:0000:0000:0000:0000:ffff:255.255.255.255';
        const raw = withNetwork({ eth0: nic([address('inet', max)]) });
        expect(stateOf(raw).primaryAddress).toBe(max);
    });

    it('does not fall back to IPv6 when the only IPv4 address is malformed', () => {
        const raw = withNetwork({ eth0: nic([address('inet', 'not an address'), v6]) });
        expect(stateOf(raw).primaryAddress).toBeNull();
    });

    it('keeps the IPv4 address when the IPv6 one is listed first on another interface', () => {
        const raw = withNetwork({ eth0: nic([v6]), eth1: nic([v4]) });
        expect(stateOf(raw).primaryAddress).toBe('192.0.2.10');
    });
});

describe('decodeInstances: hostile keys', () => {
    it('keeps Object.prototype and the output unchanged for __proto__ and constructor keys', () => {
        const json = JSON.stringify([instanceJson()]).replace(
            '"state":{',
            '"__proto__":{"polluted":true},' +
                '"constructor":{"prototype":{"polluted":true}},' +
                '"state":{"__proto__":{"polluted":true},',
        );
        const withHostileNetwork = json.replace(
            '"network":{',
            '"network":{' +
                '"__proto__":{"polluted":true,"counters":{"bytes_received":5,"bytes_sent":5}},' +
                '"constructor":{"type":"loopback","counters":{"bytes_received":9,"bytes_sent":9}},',
        );
        const metadata: unknown = JSON.parse(withHostileNetwork);
        const before = Object.getOwnPropertyNames(Object.prototype).sort();

        const result = decodeInstances(metadata);

        expect(Object.getOwnPropertyNames(Object.prototype).sort()).toStrictEqual(before);
        expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
        expect(result).toStrictEqual({
            ok: true,
            value: [
                {
                    project: 'user-1000',
                    name: 'web01',
                    type: 'container',
                    status: 'running',
                    state: { ...WEB01_STATE, rxBytes: 20518, txBytes: 771 },
                    forwards: [],
                },
            ],
        });
    });

    it('does not mutate its input', () => {
        const metadata = [instanceJson()];
        const snapshot = JSON.stringify(metadata);
        decodeInstances(metadata);
        expect(JSON.stringify(metadata)).toBe(snapshot);
    });
});

describe('decodeInstances: recorded Btrfs fixture', () => {
    const decoded = decodeInstances(readFixture('6.0', 'instances-recursion2-btrfs').metadata);
    const disks = decoded.ok ? decoded.value.map(i => [i.name, i.state?.disk]) : [];

    it('decodes both Btrfs instances', () => {
        expect(decoded.ok).toBe(true);
        expect(disks.map(([name]) => name)).toStrictEqual(['imon-btrfs-c1', 'imon-btrfs-quota']);
    });

    it('reads usage and a total of 0 for the instance without a quota', () => {
        expect(disks[0]?.[1]).toStrictEqual({ usageBytes: 52_920_320, totalBytes: 0 });
    });

    it('reads the 1 GiB root quota as the total', () => {
        expect(disks[1]?.[1]).toStrictEqual({ usageBytes: 491_520, totalBytes: 1_073_741_824 });
    });
});

describe('decodeInstances: recorded 7.0 disk values', () => {
    it('reports no disk for instances whose usage is the -1 sentinel', () => {
        const result = decodeInstances(readFixture('7.0', 'instances-recursion2').metadata);
        expect(result.ok && result.value.map(i => i.state?.disk)).toStrictEqual([
            null,
            null,
            null,
            null,
        ]);
    });
});

describe('decodeInstances: port forwards', () => {
    const proxy = (listen: unknown, connect: unknown, extra: Json = {}): Json => ({
        type: 'proxy',
        listen,
        connect,
        ...extra,
    });
    const forwardsOf = (devices: unknown): Instance['forwards'] =>
        decodeOne(instanceJson({ expanded_devices: devices })).forwards;
    const single = (port: number) => ({ first: port, last: port });

    it('is empty for the recorded instance, which has no proxy device', () => {
        expect(decodeOne(instanceJson()).forwards).toStrictEqual([]);
    });

    it('is empty when expanded_devices is absent', () => {
        expect(decodeOne(instanceJson({ expanded_devices: undefined })).forwards).toStrictEqual([]);
    });

    it('decodes a single tcp forward', () => {
        expect(forwardsOf({ web: proxy('tcp:127.0.0.1:18080', 'tcp:127.0.0.1:80') })).toStrictEqual(
            [{ protocol: 'tcp', listen: single(18080), connect: single(80) }],
        );
    });

    it('decodes a udp forward', () => {
        expect(forwardsOf({ dns: proxy('udp:0.0.0.0:5353', 'udp:127.0.0.1:53') })).toStrictEqual([
            { protocol: 'udp', listen: single(5353), connect: single(53) },
        ]);
    });

    it('decodes port ranges', () => {
        expect(
            forwardsOf({ rng: proxy('tcp:0.0.0.0:8000-8002', 'tcp:127.0.0.1:9000-9002') }),
        ).toStrictEqual([
            {
                protocol: 'tcp',
                listen: { first: 8000, last: 8002 },
                connect: { first: 9000, last: 9002 },
            },
        ]);
    });

    it('accepts a bracketed IPv6 host', () => {
        expect(forwardsOf({ v6: proxy('tcp:[::1]:8080', 'tcp:[::1]:80') })).toHaveLength(1);
    });

    it('sorts by device key in code-unit order whatever the order the daemon lists them in', () => {
        const forwards = forwardsOf({
            zeta: proxy('tcp:0.0.0.0:3', 'tcp:127.0.0.1:3'),
            alpha: proxy('tcp:0.0.0.0:1', 'tcp:127.0.0.1:1'),
            mid: proxy('tcp:0.0.0.0:2', 'tcp:127.0.0.1:2'),
        });
        expect(forwards.map(f => f.listen.first)).toStrictEqual([1, 2, 3]);
    });

    it('ignores devices that are not proxies', () => {
        const forwards = forwardsOf({
            root: { type: 'disk', path: '/', pool: 'default' },
            eth0: { type: 'nic', network: 'incusbr0' },
            fake: { type: 'disk', listen: 'tcp:0.0.0.0:1', connect: 'tcp:127.0.0.1:1' },
            web: proxy('tcp:0.0.0.0:80', 'tcp:127.0.0.1:80'),
        });
        expect(forwards.map(f => f.listen.first)).toStrictEqual([80]);
    });

    it.each<[string, unknown, unknown]>([
        ['a unix listener', 'unix:/tmp/a.sock', 'tcp:127.0.0.1:81'],
        ['a unix target', 'tcp:0.0.0.0:80', 'unix:/tmp/a.sock'],
        ['an abstract unix listener', 'unix:@name', 'tcp:127.0.0.1:81'],
        ['another protocol', 'sctp:0.0.0.0:80', 'tcp:127.0.0.1:80'],
        ['mixed protocols', 'tcp:0.0.0.0:80', 'udp:127.0.0.1:80'],
        ['no protocol', '0.0.0.0:80', '127.0.0.1:80'],
        ['an upper case protocol', 'TCP:0.0.0.0:80', 'TCP:127.0.0.1:80'],
        ['a missing port', 'tcp:0.0.0.0', 'tcp:127.0.0.1:80'],
        ['an empty host', 'tcp::80', 'tcp:127.0.0.1:80'],
        ['port 0', 'tcp:0.0.0.0:0', 'tcp:127.0.0.1:80'],
        ['a port above 65535', 'tcp:0.0.0.0:65536', 'tcp:127.0.0.1:80'],
        ['a non-numeric port', 'tcp:0.0.0.0:http', 'tcp:127.0.0.1:80'],
        ['a negative port', 'tcp:0.0.0.0:-80', 'tcp:127.0.0.1:80'],
        ['a fractional port', 'tcp:0.0.0.0:80.5', 'tcp:127.0.0.1:80'],
        ['a reversed range', 'tcp:0.0.0.0:9000-8000', 'tcp:127.0.0.1:80'],
        ['an open range', 'tcp:0.0.0.0:8000-', 'tcp:127.0.0.1:80'],
        ['a range with a bad end', 'tcp:0.0.0.0:8000-70000', 'tcp:127.0.0.1:80'],
        ['a comma list of ports', 'tcp:0.0.0.0:80,81', 'tcp:127.0.0.1:80'],
        ['an empty string', '', 'tcp:127.0.0.1:80'],
        ['a number', 80, 'tcp:127.0.0.1:80'],
        ['null', null, 'tcp:127.0.0.1:80'],
        ['a missing connect', 'tcp:0.0.0.0:80', undefined],
        ['an object', { port: 80 }, 'tcp:127.0.0.1:80'],
    ])('skips the device with %s without failing the decode', (_label, listen, connect) => {
        const forwards = forwardsOf({
            bad: proxy(listen, connect),
            good: proxy('tcp:0.0.0.0:80', 'tcp:127.0.0.1:80'),
        });
        expect(forwards.map(f => f.listen.first)).toStrictEqual([80]);
    });

    it.each<[string, unknown]>([
        ['null', null],
        ['a string', 'proxy'],
        ['an array', []],
        ['a number', 3],
    ])('gives no forwards, and no error, when expanded_devices is %s', (_label, devices) => {
        const result = decodeInstances([instanceJson({ expanded_devices: devices })]);
        expect(result.ok && result.value[0]?.forwards).toStrictEqual([]);
    });

    it.each<[string, unknown]>([
        ['null', null],
        ['a string', 'proxy'],
        ['an array', ['proxy']],
    ])('skips a device entry that is %s', (_label, entry) => {
        expect(forwardsOf({ odd: entry })).toStrictEqual([]);
    });

    it('skips an entry whose type is not the string proxy', () => {
        expect(forwardsOf({ a: proxy('tcp:0.0.0.0:1', 'tcp:127.0.0.1:1', { type: 7 }) })).toEqual(
            [],
        );
    });

    it('accepts the first and last valid ports', () => {
        const [forward] = forwardsOf({ edge: proxy('tcp:0.0.0.0:1-65535', 'tcp:127.0.0.1:65535') });
        expect([forward?.listen, forward?.connect]).toStrictEqual([
            { first: 1, last: 65535 },
            single(65535),
        ]);
    });

    it('accepts a range of one port as a single port', () => {
        const [forward] = forwardsOf({ one: proxy('tcp:0.0.0.0:80-80', 'tcp:127.0.0.1:80') });
        expect(forward?.listen).toStrictEqual(single(80));
    });

    it('orders keys by code unit, so upper case sorts before lower case', () => {
        const forwards = forwardsOf({
            b: proxy('tcp:0.0.0.0:2', 'tcp:127.0.0.1:2'),
            B: proxy('tcp:0.0.0.0:1', 'tcp:127.0.0.1:1'),
            a: proxy('tcp:0.0.0.0:3', 'tcp:127.0.0.1:3'),
        });
        expect(forwards.map(f => f.listen.first)).toStrictEqual([1, 3, 2]);
    });

    it('keeps a bind=host device, whether bind is absent or the string host', () => {
        const forwards = forwardsOf({
            a: proxy('tcp:0.0.0.0:1', 'tcp:127.0.0.1:1'),
            b: proxy('tcp:0.0.0.0:2', 'tcp:127.0.0.1:2', { bind: 'host' }),
        });
        expect(forwards.map(f => f.listen.first)).toStrictEqual([1, 2]);
    });

    // With bind=instance the listen side is inside the instance, so the line would be reversed.
    it.each<[string, unknown]>([
        ['instance', 'instance'],
        ['container', 'container'],
        ['an empty string', ''],
        ['upper case Host', 'Host'],
        ['null', null],
        ['a number', 1],
        ['an object', {}],
    ])('skips a device whose bind is %s', (_label, bind) => {
        const forwards = forwardsOf({
            rev: proxy('tcp:0.0.0.0:5', 'tcp:127.0.0.1:5', { bind }),
            good: proxy('tcp:0.0.0.0:80', 'tcp:127.0.0.1:80'),
        });
        expect(forwards.map(f => f.listen.first)).toStrictEqual([80]);
    });

    it('does not read an inherited bind', () => {
        const entry = Object.assign(Object.create({ bind: 'instance' }) as Json, {
            type: 'proxy',
            listen: 'tcp:0.0.0.0:1',
            connect: 'tcp:127.0.0.1:1',
        });
        expect(forwardsOf({ a: entry })).toHaveLength(1);
    });

    it('has no device field on a forward', () => {
        const [forward] = forwardsOf({ web: proxy('tcp:0.0.0.0:1', 'tcp:127.0.0.1:1') });
        expect(Object.keys(forward ?? {}).sort()).toStrictEqual(['connect', 'listen', 'protocol']);
    });

    // More devices than the cap never produce more forwards than the cap, and a hostile
    // daemon sending a huge map costs little.
    it('keeps at most 64 forwards however many valid devices there are', () => {
        const devices: Record<string, unknown> = {};
        for (let n = 0; n < 200; n++) {
            devices[`d${String(1000 + n)}`] = proxy('tcp:0.0.0.0:80', 'tcp:127.0.0.1:80');
        }
        expect(forwardsOf(devices)).toHaveLength(64);
    });

    it('decodes 100000 devices in under 500 ms and keeps 64', () => {
        const devices: Record<string, unknown> = {};
        for (let n = 0; n < 100_000; n++) {
            devices[`d${String(n)}`] = proxy('tcp:0.0.0.0:80', 'tcp:127.0.0.1:80');
        }
        const started = performance.now();
        const forwards = forwardsOf(devices);
        expect([forwards.length, performance.now() - started < 500]).toStrictEqual([64, true]);
    });

    it('treats __proto__ and constructor as ordinary device keys, sorted by key', () => {
        const devices: unknown = JSON.parse(
            '{"__proto__":{"type":"proxy","listen":"tcp:0.0.0.0:1","connect":"tcp:127.0.0.1:1"},' +
                '"constructor":{"type":"proxy","listen":"tcp:0.0.0.0:2","connect":"tcp:127.0.0.1:2"}}',
        );
        const before = Object.getOwnPropertyNames(Object.prototype).sort();
        const forwards = forwardsOf(devices);
        expect(forwards.map(f => f.listen.first)).toStrictEqual([1, 2]);
        expect(Object.getOwnPropertyNames(Object.prototype).sort()).toStrictEqual(before);
    });

    it('reads only own properties of a device, not inherited ones', () => {
        const entry = Object.create({
            type: 'proxy',
            listen: 'tcp:0.0.0.0:1',
            connect: 'tcp:127.0.0.1:1',
        }) as unknown;
        expect(forwardsOf({ inherited: entry })).toStrictEqual([]);
    });

    it('does not let an inherited expanded_devices key through', () => {
        const raw = Object.assign(
            Object.create({
                expanded_devices: { web: proxy('tcp:0.0.0.0:1', 'tcp:127.0.0.1:1') },
            }) as Json,
            instanceJson({ expanded_devices: undefined }),
        );
        expect(decodeOne(raw).forwards).toStrictEqual([]);
    });

    it('decodes the recorded proxy-demo instance: tcp, udp and a range, without the unix listener', () => {
        const result = decodeInstances(readFixture('6.0', 'instances-recursion1-proxy').metadata);
        expect(result.ok && result.value.map(i => [i.name, i.status])).toStrictEqual([
            ['proxy-demo', 'stopped'],
        ]);
        expect(result.ok && result.value[0]?.forwards).toStrictEqual([
            {
                protocol: 'tcp',
                listen: { first: 8000, last: 8002 },
                connect: { first: 9000, last: 9002 },
            },
            { protocol: 'udp', listen: single(5353), connect: single(53) },
            { protocol: 'tcp', listen: single(18080), connect: single(80) },
        ]);
    });
});
