// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { decodeEnvelope } from '../../../../src/core/incus/envelope.js';
import type { Envelope } from '../../../../src/core/incus/envelope.js';
import type { IncusError } from '../../../../src/core/errors.js';
import type { Result } from '../../../../src/core/result.js';

interface Fixture {
    readonly http_status: number;
    readonly body: { readonly metadata: unknown };
}

function fixture(name: string): Fixture {
    const url = new URL(`../../../fixtures/incus/6.0/${name}.json`, import.meta.url);
    // Test-only cast: fixtures are trusted, recorded files.
    return JSON.parse(readFileSync(url, 'utf8')) as Fixture;
}

function decodeFixture(name: string): ReturnType<typeof decodeEnvelope> {
    const { http_status: status, body } = fixture(name);
    return decodeEnvelope(status, JSON.stringify(body));
}

const OPERATION = '/1.0/operations/1b3f0d6e-2a8c-4e55-9a39-0d7c2a7f3c11';

function syncBody(statusCode: unknown = 200, metadata: unknown = {}): string {
    return JSON.stringify({ type: 'sync', status_code: statusCode, metadata });
}

function asyncBody(statusCode: unknown = 100, operation: unknown = OPERATION): string {
    return JSON.stringify({ type: 'async', status_code: statusCode, operation, metadata: {} });
}

function errorBody(errorCode: unknown, message: unknown = 'boom'): string {
    return JSON.stringify({ type: 'error', error_code: errorCode, error: message, metadata: null });
}

function expectProtocol(result: Result<Envelope, IncusError>): void {
    expect(result).toMatchObject({
        ok: false,
        error: { kind: 'protocol', detail: expect.stringMatching(/\S/) as unknown },
    });
}

describe('decodeEnvelope: sync', () => {
    it.each(['server', 'instances-recursion1', 'instances-recursion2'])(
        'decodes the recorded %s fixture with its metadata untouched',
        name => {
            expect(decodeFixture(name)).toStrictEqual({
                ok: true,
                value: { kind: 'sync', metadata: fixture(name).body.metadata },
            });
        },
    );

    it.each([null, [], [1, 2], {}, 'text'])('passes metadata %j through', metadata => {
        expect(decodeEnvelope(200, syncBody(200, metadata))).toStrictEqual({
            ok: true,
            value: { kind: 'sync', metadata },
        });
    });

    it.each([200, 399])('accepts status_code %d', code => {
        expect(decodeEnvelope(200, syncBody(code)).ok).toBe(true);
    });

    it.each([199, 400, 200.5, '200', null])('rejects status_code %j as protocol', code => {
        expectProtocol(decodeEnvelope(200, syncBody(code)));
    });

    it.each([200, 201, 299])('accepts HTTP status %d', status => {
        expect(decodeEnvelope(status, syncBody()).ok).toBe(true);
    });

    it.each([199, 300, 404, 500])('rejects HTTP status %d as protocol', status => {
        expectProtocol(decodeEnvelope(status, syncBody()));
    });
});

describe('decodeEnvelope: async', () => {
    it('decodes the documented async shape', () => {
        expect(decodeEnvelope(202, asyncBody())).toStrictEqual({
            ok: true,
            value: { kind: 'async', operation: OPERATION, metadata: {} },
        });
    });

    it.each([100, 199])('accepts status_code %d', code => {
        expect(decodeEnvelope(202, asyncBody(code)).ok).toBe(true);
    });

    it.each([99, 200, 100.5, '100'])('rejects status_code %j as protocol', code => {
        expectProtocol(decodeEnvelope(202, asyncBody(code)));
    });

    it.each([200, 201, 204, 500])('rejects HTTP status %d as protocol', status => {
        expectProtocol(decodeEnvelope(status, asyncBody()));
    });

    it('accepts a 64-character operation id', () => {
        expect(decodeEnvelope(202, asyncBody(100, `/1.0/operations/${'a'.repeat(64)}`)).ok).toBe(
            true,
        );
    });

    it('rejects a missing operation as protocol', () => {
        const body = JSON.stringify({ type: 'async', status_code: 100, metadata: {} });
        expectProtocol(decodeEnvelope(202, body));
    });

    it.each([
        42,
        '',
        '/1.0/instances/c1',
        '1.0/operations/x',
        '/1.0/operations',
        '/1.0/operations/',
        '/x/1.0/operations/abc',
        '/1.0/operations/../x',
        '/1.0/operations/a?b',
        '/1.0/operations/a\r\nb',
        '/1.0/operations/a b',
        '/1.0/operations/a#b',
        '/1.0/operations/%2e%2e',
        '/1.0/operations/a/wait',
        `/1.0/operations/${'a'.repeat(65)}`,
    ])('rejects operation %j as protocol', operation => {
        expectProtocol(decodeEnvelope(202, asyncBody(100, operation)));
    });
});

describe('decodeEnvelope: error', () => {
    it('maps the forbidden-project fixture (HTTP 500) to an api error', () => {
        expect(decodeFixture('error-forbidden-project')).toStrictEqual({
            ok: false,
            error: {
                kind: 'api',
                code: 500,
                message: 'User does not have permissions for project "default"',
            },
        });
    });

    it('maps the not-found fixture to an api 404 error', () => {
        expect(decodeFixture('error-not-found')).toStrictEqual({
            ok: false,
            error: {
                kind: 'api',
                code: 404,
                message:
                    'Failed to fetch instance "does-not-exist" in project "user-1000": Instance not found',
            },
        });
    });

    it.each([400, 599])('accepts error_code %d matching the HTTP status', code => {
        expect(decodeEnvelope(code, errorBody(code))).toStrictEqual({
            ok: false,
            error: { kind: 'api', code, message: 'boom' },
        });
    });

    it.each([
        [404, 500],
        [500, 404],
        [400, 401],
    ])('rejects HTTP %d with error_code %d as protocol', (status, code) => {
        expectProtocol(decodeEnvelope(status, errorBody(code)));
    });

    it.each([
        [399, 399],
        [600, 600],
        [0, 0],
        [404.5, 404],
    ])('rejects out-of-range error_code %j when HTTP is %j', (code, status) => {
        expectProtocol(decodeEnvelope(status, errorBody(code)));
    });

    it.each(['404', null])('rejects non-number error_code %j as protocol', code => {
        expectProtocol(decodeEnvelope(404, errorBody(code)));
    });

    it('caps a very long api message and keeps its start', () => {
        const result = decodeEnvelope(404, errorBody(404, 'm'.repeat(10000)));
        expect(result).toMatchObject({
            ok: false,
            error: { kind: 'api', code: 404, message: expect.stringMatching(/^mmm/) as unknown },
        });
        if (!result.ok && result.error.kind === 'api') {
            expect(result.error.message.length).toBeLessThanOrEqual(500);
        }
    });

    it('rejects a missing error message as protocol', () => {
        const body = JSON.stringify({ type: 'error', error_code: 404, metadata: null });
        expectProtocol(decodeEnvelope(404, body));
    });

    it.each([7, null])('rejects error message %j as protocol', message => {
        expectProtocol(decodeEnvelope(404, errorBody(404, message)));
    });
});

describe('decodeEnvelope: malformed input', () => {
    it.each([
        ['empty body', ''],
        ['invalid JSON', '{not json'],
        ['a JSON array', '[]'],
        ['a JSON string', '"sync"'],
        ['JSON null', 'null'],
        ['a number', '200'],
        ['missing type', '{"status_code":200,"metadata":{}}'],
        ['numeric type', '{"type":1,"status_code":200}'],
        ['unknown type', '{"type":"stream","status_code":200}'],
    ])('rejects %s as protocol', (_label, body) => {
        expectProtocol(decodeEnvelope(200, body));
    });
});

describe('decodeEnvelope: protocol detail hygiene', () => {
    const long = (c: string): string => c.repeat(1e6);
    it.each([
        ['a huge type', JSON.stringify({ type: long('x') }), 200],
        ['a huge sync status_code', JSON.stringify({ type: 'sync', status_code: long('y') }), 200],
        [
            'a huge error_code',
            JSON.stringify({ type: 'error', error_code: long('z'), error: 'e' }),
            404,
        ],
        ['a type containing DEL', JSON.stringify({ type: 'a\x7fb' }), 200],
        [
            'a huge operation',
            JSON.stringify({
                type: 'async',
                status_code: 100,
                operation: `/1.0/operations/${long('x')}`,
            }),
            202,
        ],
        [
            'an operation with a forged log line',
            JSON.stringify({
                type: 'async',
                status_code: 100,
                operation: '/1.0/operations/a\nWARN forged',
            }),
            202,
        ],
        ['a type with a bidi override', JSON.stringify({ type: 'a\u202Eb' }), 200],
        ['a type with a forged log line', JSON.stringify({ type: 'a\nWARN forged' }), 200],
    ])('keeps detail short and single-line for %s', (_label, body, status) => {
        const result = decodeEnvelope(status, body);
        expectProtocol(result);
        const detail = !result.ok && result.error.kind === 'protocol' ? result.error.detail : '';
        expect(detail.length).toBeLessThan(200);
        expect(/[\p{C}\u2028\u2029]/u.test(detail)).toBe(false);
    });
});
