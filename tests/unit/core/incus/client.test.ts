// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CancelSource } from '../../../../src/core/cancel.js';
import type { IncusError } from '../../../../src/core/errors.js';
import { IncusClient } from '../../../../src/core/incus/client.js';
import type { InstanceAction } from '../../../../src/core/incus/actions.js';
import { FakeTransport, type Reply } from '../../fakes/transport.js';

function fixtureReply(name: string): Reply {
    const url = new URL(`../../../fixtures/incus/6.0/${name}.json`, import.meta.url);
    // Test-only cast: fixtures are trusted, recorded files.
    const f = JSON.parse(readFileSync(url, 'utf8')) as { http_status: number; body: unknown };
    return { status: f.http_status, body: JSON.stringify(f.body) };
}

const OP_PATH = '/1.0/operations/1b3f0d6e-2a8c-4e55-9a39-0d7c2a7f3c11';
const REF = { project: 'user-1000', name: 'web01' };
const STATE_KEY = 'PUT /1.0/instances/web01/state?project=user-1000';
const WAIT_KEY = `GET ${OP_PATH}/wait?timeout=60&project=user-1000`;

function asyncReply(operation: unknown = OP_PATH): Reply {
    return {
        status: 202,
        body: JSON.stringify({
            type: 'async',
            status: 'Operation created',
            status_code: 100,
            operation,
            metadata: { id: 'x', status_code: 103 },
        }),
    };
}

function syncReply(metadata: unknown, status = 200): Reply {
    return { status, body: JSON.stringify({ type: 'sync', status_code: 200, metadata }) };
}

function operation(statusCode: unknown, err = ''): Reply {
    return syncReply({ id: 'x', status: 'x', status_code: statusCode, err });
}

const NEVER = new CancelSource().signal;
const OPERATION = { path: OP_PATH, project: 'user-1000' };

describe('IncusClient.server', () => {
    it('requests GET /1.0 and decodes the recorded server fixture', async () => {
        const transport = new FakeTransport({ 'GET /1.0': fixtureReply('server') });
        const result = await new IncusClient(transport).server(NEVER);
        expect(transport.requests).toStrictEqual([{ method: 'GET', path: '/1.0' }]);
        expect(result.ok && result.value.apiExtensions.size).toBeGreaterThan(0);
    });

    it('passes the api error of an error envelope through', async () => {
        const reply = fixtureReply('error-forbidden-project');
        const result = await new IncusClient(new FakeTransport({ 'GET /1.0': reply })).server(
            NEVER,
        );
        expect(result).toEqual({
            ok: false,
            error: {
                kind: 'api',
                code: 500,
                message: 'User does not have permissions for project "default"',
            },
        });
    });

    it('returns a decode error when the metadata is not a server', async () => {
        const transport = new FakeTransport({ 'GET /1.0': syncReply({ nope: 1 }) });
        const result = await new IncusClient(transport).server(NEVER);
        expect(!result.ok && result.error.kind).toBe('decode');
    });
});

describe('IncusClient strict UTF-8', () => {
    it('rejects an invalid UTF-8 byte inside a valid envelope', async () => {
        const enc = new TextEncoder();
        const body = new Uint8Array([
            ...enc.encode('{"type":"sync","status_code":200,"metadata":{"version":"'),
            0xff,
            ...enc.encode('","api_extensions":["x"]}}'),
        ]);
        const transport = new FakeTransport({ 'GET /1.0': { status: 200, body } });
        const result = await new IncusClient(transport).server(NEVER);
        expect(!result.ok && result.error.kind).toBe('protocol');
    });
});

describe('IncusClient list calls given an async envelope', () => {
    it('server returns a protocol error', async () => {
        const transport = new FakeTransport({ 'GET /1.0': asyncReply() });
        const result = await new IncusClient(transport).server(NEVER);
        expect(!result.ok && result.error.kind).toBe('protocol');
    });

    it('instances returns a protocol error', async () => {
        const key = 'GET /1.0/instances?all-projects=true&recursion=1';
        const result = await new IncusClient(new FakeTransport({ [key]: asyncReply() })).instances(
            false,
            NEVER,
        );
        expect(!result.ok && result.error.kind).toBe('protocol');
    });
});

describe('IncusClient.instances', () => {
    it.each([
        [false, 'recursion=1', 'instances-recursion1', false],
        [true, 'recursion=2', 'instances-recursion2', true],
    ])(
        'withState %s requests %s and decodes the fixture',
        async (withState, query, fixture, hasState) => {
            const key = `GET /1.0/instances?all-projects=true&${query}`;
            const transport = new FakeTransport({ [key]: fixtureReply(fixture) });
            const result = await new IncusClient(transport).instances(withState, NEVER);
            expect(transport.requests).toStrictEqual([
                { method: 'GET', path: `/1.0/instances?all-projects=true&${query}` },
            ]);
            expect(result.ok && result.value.length).toBeGreaterThan(0);
            expect(result.ok && result.value.every(i => (i.state !== null) === hasState)).toBe(
                true,
            );
        },
    );

    it('returns an empty list for empty metadata', async () => {
        const key = 'GET /1.0/instances?all-projects=true&recursion=1';
        const result = await new IncusClient(new FakeTransport({ [key]: syncReply([]) })).instances(
            false,
            NEVER,
        );
        expect(result).toEqual({ ok: true, value: [] });
    });

    it('returns a decode error for malformed metadata', async () => {
        const key = 'GET /1.0/instances?all-projects=true&recursion=1';
        const result = await new IncusClient(
            new FakeTransport({ [key]: syncReply({ not: 'a list' }) }),
        ).instances(false, NEVER);
        expect(!result.ok && result.error.kind).toBe('decode');
    });
});

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const USER_TEXT_ROWS: readonly (readonly [string, string, (message: string) => void])[] = [
    [
        '200 characters are kept',
        'x'.repeat(200),
        m => {
            expect(m).toBe('x'.repeat(200));
        },
    ],
    [
        '600 characters are cut to 500',
        'x'.repeat(600),
        m => {
            expect(m).toHaveLength(500);
        },
    ],
    [
        'a newline becomes a space',
        'a\nb',
        m => {
            expect(m).toBe('a b');
        },
    ],
    [
        'a bidi override becomes a space',
        'a\u202Eb',
        m => {
            expect(m).toBe('a b');
        },
    ],
    [
        'a zero-width space becomes a space',
        'a\u200Bb',
        m => {
            expect(m).toBe('a b');
        },
    ],
    [
        'a line separator becomes a space',
        'a\u2028b',
        m => {
            expect(m).toBe('a b');
        },
    ],
    [
        'a lone surrogate becomes a space',
        'a\uD800b',
        m => {
            expect(m).toBe('a b');
        },
    ],
    [
        'astral characters are never split',
        '😀'.repeat(300),
        m => {
            expect(m.length).toBeLessThanOrEqual(500);
            expect(LONE_SURROGATE.test(m)).toBe(false);
        },
    ],
    [
        'a cut inside an astral character leaves no lone surrogate',
        `x${'😀'.repeat(300)}`,
        m => {
            expect(m.length).toBeLessThanOrEqual(500);
            expect(LONE_SURROGATE.test(m)).toBe(false);
        },
    ],
];

const ODD_PROJECTS = ['a%b', 'a#b', 'a:b', 'héllo', 'a=b;c,d!e'];

describe('IncusClient.changeState', () => {
    it.each(ODD_PROJECTS)(
        'percent-encodes the project %s exactly in the request line',
        async project => {
            const query = encodeURIComponent(project);
            const path = `/1.0/instances/web01/state?project=${query}`;
            const transport = new FakeTransport({ [`PUT ${path}`]: asyncReply() });
            const result = await new IncusClient(transport).changeState(
                { project, name: 'web01' },
                'start',
                NEVER,
            );
            expect(transport.requests.map(r => r.path)).toStrictEqual([path]);
            expect(result).toStrictEqual({ ok: true, value: { path: OP_PATH, project } });
        },
    );

    it.each([
        ['a 63-character name', { project: 'default', name: 'a'.repeat(63) }],
        ['a 64-byte project', { project: 'p'.repeat(64), name: 'web01' }],
    ])('accepts %s', async (_label, ref) => {
        const path = `/1.0/instances/${ref.name}/state?project=${ref.project}`;
        const transport = new FakeTransport({ [`PUT ${path}`]: asyncReply() });
        const result = await new IncusClient(transport).changeState(ref, 'start', NEVER);
        expect(result.ok).toBe(true);
    });

    it.each<InstanceAction>(['start', 'stop', 'restart', 'freeze', 'unfreeze'])(
        'sends %s with a 30 s timeout and no force, and returns the operation',
        async action => {
            const transport = new FakeTransport({ [STATE_KEY]: asyncReply() });
            const result = await new IncusClient(transport).changeState(REF, action, NEVER);
            expect(transport.requests).toStrictEqual([
                {
                    method: 'PUT',
                    path: '/1.0/instances/web01/state?project=user-1000',
                    body: { action, timeout: 30, force: false },
                },
            ]);
            expect(result).toEqual({ ok: true, value: OPERATION });
        },
    );

    it('rejects an action outside the five without calling the transport', async () => {
        const transport = new FakeTransport({});
        const result = await new IncusClient(transport).changeState(
            REF,
            'delete' as InstanceAction,
            NEVER,
        );
        expect(!result.ok && result.error.kind).toBe('protocol');
        expect(transport.requests).toStrictEqual([]);
    });

    it.each([
        ['name with a slash', { project: 'default', name: 'a/b' }],
        ['name with a query character', { project: 'default', name: 'a?x=1' }],
        ['name with a space', { project: 'default', name: 'a b' }],
        ['empty name', { project: 'default', name: '' }],
        ['name starting with a digit', { project: 'default', name: '1web' }],
        ['project with an ampersand', { project: 'a&force=1', name: 'web01' }],
        ['empty project', { project: '', name: 'web01' }],
        ['64-character name', { project: 'default', name: 'a'.repeat(64) }],
        ['65-byte project', { project: 'p'.repeat(65), name: 'web01' }],
    ])('rejects a %s without calling the transport', async (_label, ref) => {
        const transport = new FakeTransport({});
        const result = await new IncusClient(transport).changeState(ref, 'start', NEVER);
        expect(!result.ok && result.error.kind).toBe('protocol');
        expect(transport.requests).toStrictEqual([]);
    });

    it('returns a protocol error when the daemon answers with a sync envelope', async () => {
        const transport = new FakeTransport({ [STATE_KEY]: syncReply({}) });
        const result = await new IncusClient(transport).changeState(REF, 'start', NEVER);
        expect(!result.ok && result.error.kind).toBe('protocol');
    });

    it('passes the not-found api error through', async () => {
        const transport = new FakeTransport({ [STATE_KEY]: fixtureReply('error-not-found') });
        const result = await new IncusClient(transport).changeState(REF, 'start', NEVER);
        expect(!result.ok && result.error.kind === 'api' && result.error.code).toBe(404);
    });
});

describe('IncusClient.wait', () => {
    it.each(ODD_PROJECTS)(
        'percent-encodes the project %s exactly in the request line',
        async project => {
            const path = `${OP_PATH}/wait?timeout=60&project=${encodeURIComponent(project)}`;
            const transport = new FakeTransport({ [`GET ${path}`]: operation(200) });
            const result = await new IncusClient(transport).wait({ path: OP_PATH, project }, NEVER);
            expect(transport.requests.map(({ method, path }) => ({ method, path }))).toStrictEqual([
                { method: 'GET', path },
            ]);
            expect(result).toStrictEqual({ ok: true, value: true });
        },
    );

    it.each([103, 201, 0, 399])(
        'returns a timeout error for the non-final operation status_code %s',
        async code => {
            const transport = new FakeTransport({ [WAIT_KEY]: operation(code) });
            const result = await new IncusClient(transport).wait(OPERATION, NEVER);
            expect(result).toStrictEqual({ ok: false, error: { kind: 'timeout' } });
        },
    );

    it('returns a decode error when err is not a string', async () => {
        const transport = new FakeTransport({ [WAIT_KEY]: operation(400, 5 as unknown as string) });
        const result = await new IncusClient(transport).wait(OPERATION, NEVER);
        expect(!result.ok && result.error.kind).toBe('decode');
    });

    it('requests the operation wait endpoint with a 60 s timeout', async () => {
        const transport = new FakeTransport({ [WAIT_KEY]: operation(200) });
        const result = await new IncusClient(transport).wait(OPERATION, NEVER);
        expect(transport.requests.map(({ method, path }) => ({ method, path }))).toStrictEqual([
            { method: 'GET', path: `${OP_PATH}/wait?timeout=60&project=user-1000` },
        ]);
        expect(result).toEqual({ ok: true, value: true });
    });

    it('gives the wait request a deadline above the 60 s the server holds it, within 90 s', async () => {
        const transport = new FakeTransport({ [WAIT_KEY]: operation(200) });
        await new IncusClient(transport).wait(OPERATION, NEVER);
        const timeoutMs = transport.requests[0]?.timeoutMs;
        expect(timeoutMs).toBeGreaterThan(60_000);
        expect(timeoutMs).toBeLessThanOrEqual(90_000);
    });

    it('sends no deadline override on server, list and state requests', async () => {
        const instancesKey = 'GET /1.0/instances?all-projects=true&recursion=1';
        const transport = new FakeTransport({
            'GET /1.0': fixtureReply('server'),
            [instancesKey]: syncReply([]),
            [STATE_KEY]: asyncReply(),
        });
        const client = new IncusClient(transport);
        await client.server(NEVER);
        await client.instances(false, NEVER);
        await client.changeState(REF, 'start', NEVER);
        expect(transport.requests.length).toBe(3);
        expect(transport.requests.map(r => r.timeoutMs)).toStrictEqual([
            undefined,
            undefined,
            undefined,
        ]);
    });

    it('returns an api error carrying the operation failure message', async () => {
        const transport = new FakeTransport({
            [WAIT_KEY]: operation(400, 'The instance is already running'),
        });
        const result = await new IncusClient(transport).wait(OPERATION, NEVER);
        expect(result).toEqual({
            ok: false,
            error: { kind: 'api', code: 400, message: 'The instance is already running' },
        });
    });

    it('returns an api error with an empty message when err is empty', async () => {
        const transport = new FakeTransport({ [WAIT_KEY]: operation(401) });
        const result = await new IncusClient(transport).wait(OPERATION, NEVER);
        expect(result).toEqual({ ok: false, error: { kind: 'api', code: 401, message: '' } });
    });

    it.each(USER_TEXT_ROWS)('sanitises the operation err: %s', async (_label, raw, check) => {
        const transport = new FakeTransport({ [WAIT_KEY]: operation(400, raw) });
        const result = await new IncusClient(transport).wait(OPERATION, NEVER);
        expect(result.ok).toBe(false);
        check(!result.ok && result.error.kind === 'api' ? result.error.message : '<not api>');
    });

    it.each([
        ['missing', undefined],
        ['null', null],
    ])('treats a %s err on status_code 400 as an empty message', async (_label, err) => {
        const body = { id: 'x', status: 'Failure', status_code: 400, err };
        const transport = new FakeTransport({ [WAIT_KEY]: syncReply(body) });
        const result = await new IncusClient(transport).wait(OPERATION, NEVER);
        expect(result).toStrictEqual({ ok: false, error: { kind: 'api', code: 400, message: '' } });
    });

    it.each([
        ['missing', undefined],
        ['null', null],
    ])('treats a %s err on status_code 200 as success', async (_label, err) => {
        const body = { id: 'x', status: 'Success', status_code: 200, err };
        const transport = new FakeTransport({ [WAIT_KEY]: syncReply(body) });
        const result = await new IncusClient(transport).wait(OPERATION, NEVER);
        expect(result).toStrictEqual({ ok: true, value: true });
    });

    it.each([
        ['a missing status_code', { id: 'x', err: '' }],
        ['a non-integer status_code', { id: 'x', status_code: 'ok', err: '' }],
        ['a fractional status_code', { id: 'x', status_code: 200.5, err: '' }],
        ['metadata that is not an object', 'done'],
        ['null metadata', null],
    ])('returns a decode error for %s', async (_label, metadata) => {
        const transport = new FakeTransport({ [WAIT_KEY]: syncReply(metadata) });
        const result = await new IncusClient(transport).wait(OPERATION, NEVER);
        expect(!result.ok && result.error.kind).toBe('decode');
    });

    it.each([
        ['an async envelope', asyncReply()],
        ['an invalid UTF-8 body', { status: 200, body: Uint8Array.of(0x7b, 0xff, 0x7d) }],
        ['a non-JSON body', { status: 200, body: 'not json' }],
    ])('returns a protocol error for %s', async (_label, reply) => {
        const transport = new FakeTransport({ [WAIT_KEY]: reply });
        const result = await new IncusClient(transport).wait(OPERATION, NEVER);
        expect(!result.ok && result.error.kind).toBe('protocol');
    });

    it.each([
        ['a path outside operations', '/1.0/instances/web01'],
        ['a path with a query', `${OP_PATH}?x=1`],
        ['a path with a sub-resource', `${OP_PATH}/wait`],
        ['a path with traversal', '/1.0/operations/../instances'],
        ['an empty id', '/1.0/operations/'],
        ['an id over 64 characters', `/1.0/operations/${'a'.repeat(65)}`],
        ['an empty path', ''],
    ])('rejects %s without calling the transport', async (_label, path) => {
        const transport = new FakeTransport({});
        const result = await new IncusClient(transport).wait({ path, project: 'default' }, NEVER);
        expect(!result.ok && result.error.kind).toBe('protocol');
        expect(transport.requests).toStrictEqual([]);
    });
});

const CALLS: readonly [
    string,
    string,
    (c: IncusClient, s: CancelSource['signal']) => Promise<unknown>,
    Reply,
][] = [
    ['server', 'GET /1.0', (c, s) => c.server(s), fixtureReply('server')],
    [
        'instances',
        'GET /1.0/instances?all-projects=true&recursion=1',
        (c, s) => c.instances(false, s),
        fixtureReply('instances-recursion1'),
    ],
    ['changeState', STATE_KEY, (c, s) => c.changeState(REF, 'start', s), asyncReply()],
    ['wait', WAIT_KEY, (c, s) => c.wait(OPERATION, s), operation(200)],
];

describe.each(CALLS)('IncusClient.%s transport handling', (_name, key, call, reply) => {
    it.each<[string, IncusError]>([
        ['not-installed', { kind: 'not-installed' }],
        ['permission-denied', { kind: 'permission-denied' }],
        ['unreachable', { kind: 'unreachable' }],
        ['timeout', { kind: 'timeout' }],
    ])('passes a %s transport error through unchanged', async (_kind, error) => {
        const result = await call(new IncusClient(new FakeTransport({ [key]: error })), NEVER);
        expect(result).toEqual({ ok: false, error });
    });

    it('returns cancelled without calling the transport when already cancelled', async () => {
        const source = new CancelSource();
        source.cancel();
        const transport = new FakeTransport({ [key]: reply });
        const result = await call(new IncusClient(transport), source.signal);
        expect(result).toEqual({ ok: false, error: { kind: 'cancelled' } });
        expect(transport.requests).toStrictEqual([]);
    });

    it('returns cancelled when cancelled while the transport is pending, even if it succeeds', async () => {
        const source = new CancelSource();
        const transport = new FakeTransport({ [key]: reply }, () => {
            source.cancel();
        });
        const result = await call(new IncusClient(transport), source.signal);
        expect(result).toEqual({ ok: false, error: { kind: 'cancelled' } });
    });

    it('hands the caller signal to the transport', async () => {
        const source = new CancelSource();
        const transport = new FakeTransport({ [key]: reply });
        await call(new IncusClient(transport), source.signal);
        expect(transport.signals).toEqual([source.signal]);
        expect(transport.signals[0]).toBe(source.signal);
    });
});
