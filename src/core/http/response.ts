// SPDX-License-Identifier: GPL-2.0-or-later
import type { IncusError } from '../errors.js';

type ProtocolError = Extract<IncusError, { kind: 'protocol' }>;

export interface HttpResponse {
    readonly status: number;
    /** Names are lower-cased; repeated headers are joined with ", ". */
    readonly headers: ReadonlyMap<string, string>;
    readonly body: Uint8Array;
}

export type ParseState =
    | { readonly kind: 'pending' }
    | { readonly kind: 'done'; readonly response: HttpResponse }
    | { readonly kind: 'error'; readonly error: ProtocolError };

// Bounds a header block, a trailer block and a chunk-size line alike.
const MAX_SECTION_BYTES = 64 * 1024;
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const MAX_CHUNK_SIZE_DIGITS = MAX_BODY_BYTES.toString(16).length;

const CRLF = Uint8Array.of(0x0d, 0x0a);
const END_OF_BLOCK = Uint8Array.of(0x0d, 0x0a, 0x0d, 0x0a);

const STATUS_LINE = /^HTTP\/1\.1 (\d{3})(?: .*)?$/;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const DIGITS = /^\d+$/;
const CHUNK_SIZE_LINE = /^([0-9A-Fa-f]+)(?:;.*)?$/;
const LATIN1_SLICE = 8192;

const PENDING: ParseState = { kind: 'pending' };

// Thrown from deep helpers and converted to a protocol state in push().
class ProtocolViolation extends Error {}

function violation(detail: string): never {
    throw new ProtocolViolation(detail);
}

/** Headers are ASCII in practice; latin1 keeps every byte value decodable. */
function latin1(bytes: Uint8Array): string {
    let text = '';
    for (let at = 0; at < bytes.length; at += LATIN1_SLICE) {
        text += String.fromCharCode(...bytes.subarray(at, at + LATIN1_SLICE));
    }
    return text;
}

/** Growable FIFO of bytes. Appends are amortised O(1) per byte; nothing is rescanned. */
class ByteBuffer {
    #data = new Uint8Array(1024);
    #start = 0;
    #end = 0;

    get length(): number {
        return this.#end - this.#start;
    }

    view(): Uint8Array {
        return this.#data.subarray(this.#start, this.#end);
    }

    append(chunk: Uint8Array): void {
        if (this.#end + chunk.length > this.#data.length) this.#makeRoom(chunk.length);
        this.#data.set(chunk, this.#end);
        this.#end += chunk.length;
    }

    consume(count: number): void {
        this.#start += count;
        if (this.#start === this.#end) {
            this.#start = 0;
            this.#end = 0;
        }
    }

    /** Offset of the first match ending by `limit`, or -1; offsets count from the unread start. */
    indexOf(pattern: Uint8Array, from: number, limit: number): number {
        const last = this.#start + Math.min(limit, this.length) - pattern.length;
        for (let at = this.#start + from; at <= last; at++) {
            if (this.#matchesAt(pattern, at)) return at - this.#start;
        }
        return -1;
    }

    startsWith(pattern: Uint8Array): boolean {
        return this.length >= pattern.length && this.#matchesAt(pattern, this.#start);
    }

    #matchesAt(pattern: Uint8Array, at: number): boolean {
        for (let i = 0; i < pattern.length; i++) {
            if (this.#data[at + i] !== pattern[i]) return false;
        }
        return true;
    }

    #makeRoom(extra: number): void {
        const needed = this.length + extra;
        let capacity = this.#data.length;
        while (capacity < needed) capacity *= 2;
        // The unread bytes may overlap their destination; TypedArray.set handles that.
        const target = capacity === this.#data.length ? this.#data : new Uint8Array(capacity);
        target.set(this.view());
        this.#data = target;
        this.#end = this.length;
        this.#start = 0;
    }
}

type Phase =
    'head' | 'length-body' | 'chunk-size' | 'chunk-data' | 'chunk-crlf' | 'trailers' | 'eof-body';

/**
 * Incremental HTTP/1.1 response parser. Input is buffered once and consumed by a small state
 * machine, so the cost of a response is linear in its size however the bytes are split.
 */
export class ResponseParser {
    #result: ParseState = PENDING;
    #phase: Phase = 'head';
    readonly #input = new ByteBuffer();
    readonly #body = new ByteBuffer();
    // Bytes of #input already searched for a terminator, so a split terminator is still found.
    #scanned = 0;
    #status = 0;
    #headers: ReadonlyMap<string, string> = new Map();
    #remaining = 0;
    #declared = 0;

    push(chunk: Uint8Array): ParseState {
        if (this.#result.kind !== 'pending') return this.#result;
        try {
            this.#input.append(chunk);
            // A step returns false when it needs more input or the parse has ended.
            while (this.#step()) {
                // Each step consumes input or changes phase.
            }
        } catch (e) {
            if (!(e instanceof ProtocolViolation)) throw e;
            return this.#fail(e.message);
        }
        return this.#result;
    }

    /** Signals end of input: completes a read-to-EOF body, otherwise the message was cut short. */
    finish(): ParseState {
        if (this.#result.kind !== 'pending') return this.#result;
        if (this.#phase === 'eof-body') return this.#complete();
        return this.#fail('connection closed before the response was complete');
    }

    #fail(detail: string): ParseState {
        this.#result = { kind: 'error', error: { kind: 'protocol', detail } };
        return this.#result;
    }

    #step(): boolean {
        switch (this.#phase) {
            case 'head':
                return this.#readHead();
            case 'length-body':
                return this.#readLengthBody();
            case 'chunk-size':
                return this.#readChunkSize();
            case 'chunk-data':
                return this.#readChunkData();
            case 'chunk-crlf':
                return this.#readChunkCrlf();
            case 'trailers':
                return this.#readTrailers();
            case 'eof-body':
                return this.#readEofBody();
        }
    }

    #complete(): ParseState {
        this.#result = {
            kind: 'done',
            response: { status: this.#status, headers: this.#headers, body: this.#body.view() },
        };
        return this.#result;
    }

    /**
     * Lines up to and including an empty line, or undefined while incomplete. Headers and
     * trailers share this grammar; the limit counts through the final CRLFCRLF.
     */
    #takeBlock(): readonly string[] | undefined {
        if (this.#input.startsWith(CRLF)) {
            this.#input.consume(CRLF.length);
            return [];
        }
        const block = this.#takeUntil(END_OF_BLOCK, MAX_SECTION_BYTES, 'header section too large');
        return block && latin1(block).split('\r\n');
    }

    /**
     * Consumes and returns the bytes before `terminator`, or undefined while it has not arrived.
     * `limit` counts through the terminator; the scan resumes where the previous push stopped.
     */
    #takeUntil(terminator: Uint8Array, limit: number, tooLarge: string): Uint8Array | undefined {
        const from = Math.max(0, this.#scanned - terminator.length + 1);
        const end = this.#input.indexOf(terminator, from, limit);
        if (end < 0) {
            this.#scanned = this.#input.length;
            // A terminator that fitted would already have been found.
            if (this.#input.length >= limit) violation(tooLarge);
            return undefined;
        }
        const taken = this.#input.view().subarray(0, end);
        this.#input.consume(end + terminator.length);
        this.#scanned = 0;
        return taken;
    }

    #readHead(): boolean {
        const lines = this.#takeBlock();
        if (lines === undefined) return false;
        this.#parseHead(lines);
        return true;
    }

    #parseHead(lines: readonly string[]): void {
        const [statusLine = '', ...headerLines] = lines;
        const match = STATUS_LINE.exec(statusLine);
        if (!match) violation('malformed status line');
        const status = Number(match[1]);
        if (status < 100 || status > 599) violation('malformed status line');
        this.#status = status;
        const headers = new Map<string, string>();
        for (const line of headerLines) {
            const colon = line.indexOf(':');
            const name = line.slice(0, colon).toLowerCase();
            const value = line.slice(colon + 1);
            if (colon < 1 || !HEADER_NAME.test(name) || /[\r\n]/.test(value)) {
                violation('malformed header line');
            }
            const previous = headers.get(name);
            const trimmed = value.trim();
            headers.set(name, previous === undefined ? trimmed : `${previous}, ${trimmed}`);
        }
        this.#headers = headers;
        this.#chooseFraming(headers);
    }

    #chooseFraming(headers: ReadonlyMap<string, string>): void {
        const encoding = headers.get('transfer-encoding');
        if (encoding !== undefined) {
            if (encoding.toLowerCase() !== 'chunked') violation('unsupported transfer encoding');
            this.#phase = 'chunk-size';
            return;
        }
        const length = headers.get('content-length');
        if (length === undefined) {
            this.#phase = 'eof-body';
            return;
        }
        const [only, ...others] = new Set(length.split(',').map(v => v.trim()));
        if (only === undefined || others.length > 0 || !DIGITS.test(only)) {
            violation('invalid Content-Length');
        }
        this.#remaining = Number(only);
        if (this.#remaining > MAX_BODY_BYTES) violation('response body too large');
        this.#phase = 'length-body';
    }

    #readLengthBody(): boolean {
        this.#moveBody();
        if (this.#remaining === 0) this.#complete();
        return false;
    }

    #readEofBody(): boolean {
        if (this.#body.length + this.#input.length > MAX_BODY_BYTES) {
            violation('response body too large');
        }
        this.#body.append(this.#input.view());
        this.#input.consume(this.#input.length);
        return false;
    }

    /** Moves up to `#remaining` bytes from the input to the body. */
    #moveBody(): void {
        const count = Math.min(this.#remaining, this.#input.length);
        this.#body.append(this.#input.view().subarray(0, count));
        this.#input.consume(count);
        this.#remaining -= count;
    }

    #readChunkSize(): boolean {
        const taken = this.#takeUntil(
            CRLF,
            MAX_SECTION_BYTES + CRLF.length,
            'chunk-size line too long',
        );
        if (taken === undefined) return false;
        const line = latin1(taken);
        const digits = CHUNK_SIZE_LINE.exec(line)?.[1]?.replace(/^0+(?=.)/, '');
        if (digits === undefined) violation('malformed chunk size');
        if (digits.length > MAX_CHUNK_SIZE_DIGITS) violation('response body too large');
        const size = Number.parseInt(digits, 16);
        // Declared sizes count, so an oversized body is refused before its data is read.
        this.#declared += size;
        if (this.#declared > MAX_BODY_BYTES) violation('response body too large');
        this.#remaining = size;
        this.#phase = size === 0 ? 'trailers' : 'chunk-data';
        return true;
    }

    #readChunkData(): boolean {
        this.#moveBody();
        if (this.#remaining > 0) return false;
        this.#phase = 'chunk-crlf';
        return true;
    }

    #readChunkCrlf(): boolean {
        if (this.#input.length < CRLF.length) return false;
        if (!this.#input.startsWith(CRLF)) violation('missing CRLF after chunk data');
        this.#input.consume(CRLF.length);
        this.#phase = 'chunk-size';
        return true;
    }

    #readTrailers(): boolean {
        if (this.#takeBlock() === undefined) return false;
        this.#complete();
        return false;
    }
}
