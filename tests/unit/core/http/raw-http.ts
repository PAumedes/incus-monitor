// SPDX-License-Identifier: GPL-2.0-or-later
import { readdirSync, readFileSync } from 'node:fs';

const enc = new TextEncoder();

export function bytes(text: string): Uint8Array {
    return enc.encode(text);
}

export function concat(...parts: readonly Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of parts) {
        out.set(p, at);
        at += p.length;
    }
    return out;
}

/** Incus sends small bodies chunked too, so the chunk size is deliberately small. */
export function chunked(body: Uint8Array, chunkSize = 100): Uint8Array {
    const parts: Uint8Array[] = [];
    for (let at = 0; at < body.length; at += chunkSize) {
        const piece = body.subarray(at, at + chunkSize);
        parts.push(bytes(`${piece.length.toString(16)}\r\n`), piece, bytes('\r\n'));
    }
    parts.push(bytes('0\r\n\r\n'));
    return concat(...parts);
}

export function rawResponse(
    status: number,
    framing: 'chunked' | 'content-length',
    body: Uint8Array,
): Uint8Array {
    const head =
        `HTTP/1.1 ${String(status)} Status\r\nContent-Type: application/json\r\n` +
        `Etag: "abc"\r\nDate: Mon, 05 Oct 2026 10:00:00 GMT\r\n` +
        (framing === 'chunked'
            ? 'Transfer-Encoding: chunked\r\n\r\n'
            : `Content-Length: ${String(body.length)}\r\n\r\n`);
    return concat(bytes(head), framing === 'chunked' ? chunked(body) : body);
}

export interface FixtureResponse {
    readonly name: string;
    readonly status: number;
    readonly body: Uint8Array;
}

export function fixtureResponses(): readonly FixtureResponse[] {
    const dir = new URL('../../../fixtures/incus/6.0/', import.meta.url);
    return readdirSync(dir)
        .filter(f => f.endsWith('.json'))
        .map(name => {
            const parsed: unknown = JSON.parse(readFileSync(new URL(name, dir), 'utf8'));
            if (
                typeof parsed !== 'object' ||
                parsed === null ||
                !('http_status' in parsed) ||
                typeof parsed.http_status !== 'number' ||
                !('body' in parsed)
            ) {
                throw new Error(`fixture ${name} lacks http_status/body`);
            }
            return { name, status: parsed.http_status, body: bytes(JSON.stringify(parsed.body)) };
        });
}
