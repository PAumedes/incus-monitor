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
