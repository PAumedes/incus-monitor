// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';

import { encodeRequest } from '../../../../src/core/http/request.js';

const decode = (b: Uint8Array): string => new TextDecoder().decode(b);

describe('encodeRequest', () => {
    it('serialises a GET with the documented headers in order', () => {
        const out = encodeRequest({ method: 'GET', path: '/1.0/instances?recursion=1' });
        expect(decode(out)).toBe(
            'GET /1.0/instances?recursion=1 HTTP/1.1\r\n' +
                'Host: incus\r\n' +
                'Accept: application/json\r\n' +
                'User-Agent: incus-monitor\r\n' +
                'Connection: close\r\n' +
                '\r\n',
        );
    });

    it('produces exactly the expected bytes for a PUT with a non-ASCII body', () => {
        const json = '{"name":"é"}';
        const expected = new TextEncoder().encode(
            'PUT /x HTTP/1.1\r\nHost: incus\r\nAccept: application/json\r\n' +
                'User-Agent: incus-monitor\r\nConnection: close\r\n' +
                'Content-Type: application/json\r\nContent-Length: 13\r\n\r\n' +
                json,
        );
        expect(encodeRequest({ method: 'PUT', path: '/x', body: { name: 'é' } })).toStrictEqual(
            expected,
        );
    });

    it.each([
        ['a function', () => 1],
        ['toJSON returning undefined', { toJSON: () => undefined }],
    ])('throws when the body (%s) serialises to nothing', (_label, body) => {
        expect(() => encodeRequest({ method: 'PUT', path: '/x', body })).toThrow();
    });

    it('does not embed an unbounded path in the error message', () => {
        const path = '/' + 'é'.repeat(1e6);
        let message = '';
        try {
            encodeRequest({ method: 'GET', path });
        } catch (e) {
            message = e instanceof Error ? e.message : String(e);
        }
        expect(message).not.toBe('');
        expect(message.length).toBeLessThan(200);
    });

    it('sends no content headers when the body is absent', () => {
        const text = decode(encodeRequest({ method: 'GET', path: '/1.0' }));
        expect(text).not.toContain('Content-Type');
        expect(text).not.toContain('Content-Length');
    });

    it.each([
        ['LF', '/1.0\nX-Evil: 1'],
        ['CR', '/1.0\rX-Evil: 1'],
        ['CRLF', '/1.0\r\nX-Evil: 1'],
        ['space', '/1.0 HTTP/1.0'],
        ['missing leading slash', '1.0/instances'],
        ['empty', ''],
        ['tab', '/1.0\tx'],
        ['NUL', '/1.0\0x'],
        ['DEL', '/1.0\x7fx'],
        ['non-ASCII character', '/é'],
    ])('throws on a path with %s', (_label, path) => {
        expect(() => encodeRequest({ method: 'GET', path })).toThrow();
    });
});
