// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';

import { ResponseParser } from '../../../../src/core/http/response.js';
import type { ParseState } from '../../../../src/core/http/response.js';
import { bytes, concat, fixtureResponses, rawResponse } from './raw-http.js';

const KiB = 1024;
const MiB = 1024 * KiB;

function parseAll(...chunks: Uint8Array[]): ParseState {
    const parser = new ResponseParser();
    let state: ParseState = PENDING;
    for (const c of chunks) state = parser.push(c);
    return state;
}

function expectDone(state: ParseState) {
    if (state.kind !== 'done') throw new Error(`expected done, got ${JSON.stringify(state)}`);
    return state.response;
}

function expectProtocol(state: ParseState): void {
    expect(state).toMatchObject({ kind: 'error', error: { kind: 'protocol' } });
    expect(state).toHaveProperty('error.detail');
}

const binary = Uint8Array.of(0xff, 0xfe, 0xc3, 0x28, 0x00, 0x0d, 0x0a);
const PENDING: ParseState = { kind: 'pending' };
const text = (b: Uint8Array): string => new TextDecoder().decode(b);

describe('ResponseParser framing', () => {
    it('parses a Content-Length response', () => {
        const res = expectDone(
            parseAll(
                bytes('HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Type: text/x\r\n\r\nhello'),
            ),
        );
        expect(res.status).toBe(200);
        expect(text(res.body)).toBe('hello');
        expect(res.headers.get('content-length')).toBe('5');
        expect(res.headers.get('content-type')).toBe('text/x');
    });

    it('lower-cases header names and joins repeated headers with ", "', () => {
        const res = expectDone(
            parseAll(bytes('HTTP/1.1 200 OK\r\nX-Foo: a\r\nx-foo: b\r\nContent-Length: 0\r\n\r\n')),
        );
        expect(res.headers.get('x-foo')).toBe('a, b');
    });

    it('stays pending until the headers are complete', () => {
        expect(parseAll(bytes('HTTP/1.1 200 OK\r\nContent-Length: 1\r\n'))).toStrictEqual(PENDING);
    });

    it('stays pending until the Content-Length body is complete', () => {
        expect(parseAll(bytes('HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhel'))).toStrictEqual(
            PENDING,
        );
    });

    it('parses a chunked response', () => {
        const res = expectDone(
            parseAll(
                bytes(
                    'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n' +
                        '5\r\nhello\r\n6\r\n world\r\n0\r\n\r\n',
                ),
            ),
        );
        expect(text(res.body)).toBe('hello world');
    });

    it.each([
        ['lower-case hex', 'a\r\n0123456789\r\n'],
        ['upper-case hex', 'A\r\n0123456789\r\n'],
        ['chunk extensions', 'a;name=value;flag\r\n0123456789\r\n'],
    ])('accepts a chunk size with %s', (_label, chunk) => {
        const res = expectDone(
            parseAll(
                bytes(`HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n${chunk}0\r\n\r\n`),
            ),
        );
        expect(text(res.body)).toBe('0123456789');
    });

    it('ignores trailers after the last chunk', () => {
        const res = expectDone(
            parseAll(
                bytes(
                    'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n' +
                        '2\r\nok\r\n0\r\nX-Trailer: 1\r\nX-Other: 2\r\n\r\n',
                ),
            ),
        );
        expect(text(res.body)).toBe('ok');
        expect(res.headers.has('x-trailer')).toBe(false);
    });

    it('prefers chunked over Content-Length', () => {
        const res = expectDone(
            parseAll(
                bytes(
                    'HTTP/1.1 200 OK\r\nContent-Length: 99\r\nTransfer-Encoding: chunked\r\n\r\n' +
                        '2\r\nok\r\n0\r\n\r\n',
                ),
            ),
        );
        expect(text(res.body)).toBe('ok');
    });

    it('stays pending while a chunked body lacks its terminator', () => {
        expect(
            parseAll(bytes('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nok\r\n')),
        ).toStrictEqual(PENDING);
    });

    it('reads to EOF when there is no length and finish() is called', () => {
        const parser = new ResponseParser();
        expect(parser.push(bytes('HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nabc'))).toStrictEqual(
            {
                kind: 'pending',
            },
        );
        expect(parser.push(bytes('def'))).toStrictEqual(PENDING);
        expect(text(expectDone(parser.finish()).body)).toBe('abcdef');
    });

    it('completes an empty read-to-EOF body on finish()', () => {
        const parser = new ResponseParser();
        parser.push(bytes('HTTP/1.1 204 No Content\r\n\r\n'));
        expect(expectDone(parser.finish()).body.length).toBe(0);
    });

    it.each([
        ['before the headers end', 'HTTP/1.1 200 OK\r\nContent-Le'],
        ['inside a Content-Length body', 'HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhe'],
        ['inside a chunked body', 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhe'],
        ['with no bytes at all', ''],
    ])('reports a protocol error when EOF arrives %s', (_label, raw) => {
        const parser = new ResponseParser();
        if (raw) parser.push(bytes(raw));
        expectProtocol(parser.finish());
    });
});

describe('ResponseParser terminal states', () => {
    it('returns the same done state for later push and finish', () => {
        const parser = new ResponseParser();
        const done = parser.push(bytes('HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n'));
        expect(done.kind).toBe('done');
        expect(parser.push(bytes('garbage'))).toStrictEqual(done);
        expect(parser.finish()).toStrictEqual(done);
    });

    it('returns the same error state for later push and finish', () => {
        const parser = new ResponseParser();
        const failed = parser.push(bytes('NOPE\r\n\r\n'));
        expectProtocol(failed);
        expect(parser.push(bytes('HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n'))).toStrictEqual(
            failed,
        );
        expect(parser.finish()).toStrictEqual(failed);
    });
});

describe('ResponseParser malformed input', () => {
    it.each([
        ['status line without a version', 'GET 200 OK\r\n\r\n'],
        ['status line with a non-numeric status', 'HTTP/1.1 abc OK\r\n\r\n'],
        ['status line with a missing status', 'HTTP/1.1\r\n\r\n'],
        ['header line without a colon', 'HTTP/1.1 200 OK\r\nBadHeader\r\n\r\n'],
        ['header with an empty name', 'HTTP/1.1 200 OK\r\n: value\r\n\r\n'],
        ['non-numeric Content-Length', 'HTTP/1.1 200 OK\r\nContent-Length: abc\r\n\r\n'],
        ['negative Content-Length', 'HTTP/1.1 200 OK\r\nContent-Length: -1\r\n\r\n'],
        ['Content-Length with trailing junk', 'HTTP/1.1 200 OK\r\nContent-Length: 12abc\r\n\r\n'],
        ['Content-Length with a plus sign', 'HTTP/1.1 200 OK\r\nContent-Length: +5\r\n\r\n'],
        [
            'pair of conflicting Content-Length headers',
            'HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Length: 6\r\n\r\nhello!',
        ],
        [
            'joined list of conflicting Content-Length values',
            'HTTP/1.1 200 OK\r\nContent-Length: 5, 6\r\n\r\nhello!',
        ],
        ['bare LF in the header block', 'HTTP/1.1 200 OK\nX: 1\r\n\r\n'],
        ['status below 100', 'HTTP/1.1 99 X\r\n\r\n'],
        ['status with four digits', 'HTTP/1.1 2000 X\r\n\r\n'],
        ['status above 599', 'HTTP/1.1 600 X\r\n\r\n'],
        [
            'Transfer-Encoding other than chunked',
            'HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip\r\n\r\n',
        ],
        [
            'Transfer-Encoding list ending in chunked',
            'HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip, chunked\r\n\r\n0\r\n\r\n',
        ],
    ])('rejects a %s', (_label, raw) => {
        expectProtocol(parseAll(bytes(raw)));
    });

    it.each([
        ['non-hex chunk size', 'zz\r\nhi\r\n0\r\n\r\n'],
        ['empty chunk size', '\r\nhi\r\n0\r\n\r\n'],
        ['missing CRLF after chunk data', '2\r\nhiXX0\r\n\r\n'],
        ['0x prefix on the chunk size', '0x2\r\nhi\r\n0\r\n\r\n'],
        ['leading space in the chunk size', ' 2\r\nhi\r\n0\r\n\r\n'],
        ['junk after the chunk size', '2 junk\r\nhi\r\n0\r\n\r\n'],
    ])('rejects a chunked body with a %s', (_label, chunks) => {
        expectProtocol(
            parseAll(bytes(`HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n${chunks}`)),
        );
    });
});

describe('ResponseParser limits', () => {
    it('rejects an endless header section without waiting for its end', () => {
        const parser = new ResponseParser();
        let state = parser.push(bytes('HTTP/1.1 200 OK\r\n'));
        for (let i = 0; i < 80 && state.kind === 'pending'; i++) {
            state = parser.push(bytes(`X-${String(i)}: ${'a'.repeat(KiB)}\r\n`));
        }
        expectProtocol(state);
    });

    it('rejects a Content-Length above 32 MiB before reading any body', () => {
        expectProtocol(
            parseAll(bytes(`HTTP/1.1 200 OK\r\nContent-Length: ${String(32 * MiB + 1)}\r\n\r\n`)),
        );
    });

    it('rejects a read-to-EOF body as soon as it exceeds 32 MiB', () => {
        const parser = new ResponseParser();
        parser.push(bytes('HTTP/1.1 200 OK\r\n\r\n'));
        const block = new Uint8Array(MiB);
        let state: ParseState = PENDING;
        for (let i = 0; i < 32; i++) state = parser.push(block);
        expect(state.kind).toBe('pending');
        expectProtocol(parser.push(new Uint8Array(1)));
    });

    it('rejects a chunked body as soon as it exceeds 32 MiB', () => {
        const parser = new ResponseParser();
        parser.push(bytes('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n'));
        const block = concat(bytes('100000\r\n'), new Uint8Array(MiB), bytes('\r\n'));
        let state: ParseState = PENDING;
        for (let i = 0; i < 32; i++) state = parser.push(block);
        expect(state.kind).toBe('pending');
        expectProtocol(parser.push(bytes('1\r\nx\r\n')));
    });
});

describe('ResponseParser strictness and binary safety', () => {
    it('accepts identical duplicate Content-Length headers', () => {
        const res = expectDone(
            parseAll(
                bytes('HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Length: 5\r\n\r\nhello'),
            ),
        );
        expect(text(res.body)).toBe('hello');
    });

    it.each(['Chunked', 'CHUNKED'])('accepts Transfer-Encoding %s as chunked', value => {
        const res = expectDone(
            parseAll(
                bytes(`HTTP/1.1 200 OK\r\nTransfer-Encoding: ${value}\r\n\r\n2\r\nok\r\n0\r\n\r\n`),
            ),
        );
        expect(text(res.body)).toBe('ok');
    });

    it.each(['chunked', 'content-length'] as const)(
        'keeps arbitrary bytes in a %s body',
        framing => {
            const res = expectDone(parseAll(rawResponse(200, framing, binary)));
            expect(Array.from(res.body)).toStrictEqual(Array.from(binary));
        },
    );

    it('keeps a UTF-8 character that is split across chunks', () => {
        const utf8 = bytes('é€😀');
        const raw = concat(
            bytes('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n'),
            bytes('1\r\n'),
            utf8.subarray(0, 1),
            bytes('\r\n'),
            bytes(`${(utf8.length - 1).toString(16)}\r\n`),
            utf8.subarray(1),
            bytes('\r\n0\r\n\r\n'),
        );
        expect(text(expectDone(parseAll(raw)).body)).toBe('é€😀');
    });

    it.each([
        ['Content-Length body', 'HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhelloEXTRA'],
        [
            'chunked terminator',
            'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\nEXTRA',
        ],
    ])('ignores bytes after the %s', (_label, raw) => {
        expect(text(expectDone(parseAll(bytes(raw))).body)).toBe('hello');
    });

    function headerSection(totalBytes: number): Uint8Array {
        const base = 'HTTP/1.1 200 OK\r\nX-Pad: \r\nContent-Length: 0\r\n\r\n';
        return bytes(base.replace('X-Pad: ', `X-Pad: ${'a'.repeat(totalBytes - base.length)}`));
    }

    it('accepts a header section of exactly 64 KiB', () => {
        const raw = headerSection(64 * KiB);
        expect(raw.length).toBe(65536);
        expectDone(parseAll(raw));
    });

    it('rejects a header section of 64 KiB plus one byte', () => {
        expectProtocol(parseAll(headerSection(64 * KiB + 1)));
    });

    it('accepts a Content-Length of exactly 32 MiB at the header stage', () => {
        expect(
            parseAll(bytes(`HTTP/1.1 200 OK\r\nContent-Length: ${String(32 * MiB)}\r\n\r\n`)),
        ).toStrictEqual(PENDING);
    });

    it('rejects a chunk that declares more than 32 MiB before its data arrives', () => {
        expectProtocol(
            parseAll(bytes('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2000001\r\n')),
        );
    });

    it('rejects a chunk whose declared size pushes the total past 32 MiB before its data', () => {
        const parser = new ResponseParser();
        parser.push(bytes('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n'));
        const first = parser.push(concat(bytes('100000\r\n'), new Uint8Array(MiB), bytes('\r\n')));
        expect(first.kind).toBe('pending');
        // 31 MiB + 1 on top of the 1 MiB already received.
        expectProtocol(parser.push(bytes('1F00001\r\n')));
    });

    it('rejects a chunk-size line that is not terminated within 64 KiB', () => {
        const parser = new ResponseParser();
        parser.push(bytes('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1;'));
        let state: ParseState = PENDING;
        for (let i = 0; i < 80 && state.kind === 'pending'; i++) {
            state = parser.push(bytes('a'.repeat(KiB)));
        }
        expectProtocol(state);
    });

    it('rejects a trailer section above 64 KiB', () => {
        const parser = new ResponseParser();
        let state = parser.push(
            bytes('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n'),
        );
        for (let i = 0; i < 80 && state.kind === 'pending'; i++) {
            state = parser.push(bytes(`X-${String(i)}: ${'a'.repeat(KiB)}\r\n`));
        }
        expectProtocol(state);
    });
});

describe('ResponseParser on recorded Incus responses', () => {
    // Every offset of every fixture is parsed, which takes longer than the default timeout.
    const slowTimeout = 30_000;

    /** Cheap comparable form: toStrictEqual on large Uint8Arrays is very slow. */
    function norm(state: ParseState): unknown {
        if (state.kind === 'pending') return PENDING;
        if (state.kind === 'error') return { kind: 'error', error: state.error };
        const { status, headers, body } = state.response;
        return {
            kind: 'done',
            status,
            headers: [...headers.entries()],
            body: Buffer.from(body).toString('latin1'),
        };
    }

    const fixtures = fixtureResponses();
    const eofHead = 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nEtag: "abc"\r\n\r\n';
    const cases = fixtures.flatMap(f => [
        ...(['chunked', 'content-length'] as const).map(framing => ({
            label: `${f.name} (${framing})`,
            f,
            raw: rawResponse(f.status, framing, f.body),
            eof: false,
        })),
        {
            label: `${f.name} (read-to-EOF)`,
            f,
            raw: concat(bytes(eofHead.replace('200', String(f.status))), f.body),
            eof: true,
        },
    ]);

    function run(raw: Uint8Array, eof: boolean, splits: readonly number[]): unknown {
        const parser = new ResponseParser();
        let state: ParseState = PENDING;
        let from = 0;
        for (const at of [...splits, raw.length]) {
            state = parser.push(raw.subarray(from, at));
            from = at;
        }
        return norm(eof ? parser.finish() : state);
    }

    it.each(cases)('decodes $label to its status and body', ({ f, raw, eof }) => {
        const parser = new ResponseParser();
        const pushed = parser.push(raw);
        const res = expectDone(eof ? parser.finish() : pushed);
        expect(res.status).toBe(f.status);
        expect(Buffer.from(res.body).equals(f.body)).toBe(true);
        expect(res.headers.get('content-type')).toBe('application/json');
        expect(res.headers.get('etag')).toBe('"abc"');
    });

    it.each(cases)(
        'gives the same result for $label split at every offset',
        ({ raw, eof }) => {
            const whole = run(raw, eof, []);
            expect(whole).toHaveProperty('kind', 'done');
            for (let at = 0; at <= raw.length; at++) {
                expect(run(raw, eof, [at]), `split at ${String(at)}`).toStrictEqual(whole);
            }
        },
        slowTimeout,
    );

    it.each(['chunked', 'content-length'] as const)(
        'gives the same result when a %s response arrives one byte at a time',
        framing => {
            const f = fixtures.find(x => x.name === 'instances-recursion1.json');
            if (!f) throw new Error('fixture instances-recursion1.json is missing');
            const raw = rawResponse(f.status, framing, f.body);
            const parser = new ResponseParser();
            let state: ParseState = PENDING;
            for (let i = 0; i < raw.length; i++) {
                expect(state.kind, `early completion at byte ${String(i)}`).toBe('pending');
                state = parser.push(raw.subarray(i, i + 1));
            }
            expect(norm(state)).toStrictEqual(run(raw, false, []));
            expect(state.kind).toBe('done');
        },
        slowTimeout,
    );
});
