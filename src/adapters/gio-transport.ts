// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import type { IncusError } from '../core/errors.js';
import { encodeRequest, type HttpRequest } from '../core/http/request.js';
import { ResponseParser, type HttpResponse } from '../core/http/response.js';
import type { Clock, Transport } from '../core/ports.js';
import { err, ok, type Result } from '../core/result.js';
import type { CancelSignal } from '../core/cancel.js';
import { isIOError } from './io-error.js';

Gio._promisify(Gio.SocketClient.prototype, 'connect_async', 'connect_finish');
Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');
Gio._promisify(Gio.OutputStream.prototype, 'write_bytes_async', 'write_bytes_finish');
Gio._promisify(Gio.IOStream.prototype, 'close_async', 'close_finish');

export interface TransportTimeouts {
    /** Time allowed to open the connection. */
    readonly connectMs: number;
    /** Default total time for the exchange after connecting; a request's `timeoutMs` replaces it. */
    readonly requestMs: number;
}

export const TRANSPORT_TIMEOUTS: TransportTimeouts = {
    connectMs: 2000,
    requestMs: 10_000,
};

export interface GioTransportOptions {
    readonly timeouts?: Partial<TransportTimeouts>;
    /**
     * Test seam: observes the size of every read, to assert reads stay bounded. Not part of the
     * transport's contract; production code must not pass it.
     */
    readonly onRead?: (bytes: number) => void;
}

// A hostile peer must not monopolise the compositor: each read is bounded and is its own
// main-loop dispatch.
const MAX_READ_BYTES = 64 * 1024;

type PlainFailure = Extract<
    IncusError,
    { kind: 'not-installed' | 'permission-denied' | 'unreachable' | 'timeout' | 'cancelled' }
>;

const failure = (kind: PlainFailure['kind']) => err<IncusError>({ kind });

/** HTTP over a unix socket, one connection per request (`Connection: close`). */
export class GioTransport implements Transport {
    readonly #path: string;
    readonly #clock: Clock;
    readonly #timeouts: TransportTimeouts;
    readonly #onRead: ((bytes: number) => void) | undefined;

    constructor(socketPath: string, clock: Clock, options: GioTransportOptions = {}) {
        this.#path = socketPath;
        this.#clock = clock;
        this.#timeouts = { ...TRANSPORT_TIMEOUTS, ...options.timeouts };
        this.#onRead = options.onRead;
    }

    async request(
        request: HttpRequest,
        signal: CancelSignal,
    ): Promise<Result<HttpResponse, IncusError>> {
        if (signal.cancelled) return failure('cancelled');
        let encoded: Uint8Array;
        try {
            encoded = encodeRequest(request);
        } catch (error) {
            return err({ kind: 'protocol', detail: String(error) });
        }

        const cancellable = new Gio.Cancellable();
        const off = signal.onCancel(() => {
            cancellable.cancel();
        });
        // One timer at a time; expiring marks the exchange as timed out and aborts the pending I/O.
        let expired = false;
        let stopTimer = (): void => undefined;
        const arm = (ms: number): void => {
            stopTimer();
            stopTimer = this.#clock.setTimeout(ms, () => {
                expired = true;
                cancellable.cancel();
            });
        };
        let connection: Gio.SocketConnection | undefined;
        try {
            arm(this.#timeouts.connectMs);
            connection = await new Gio.SocketClient().connect_async(
                Gio.UnixSocketAddress.new(this.#path),
                cancellable,
            );
            arm(request.timeoutMs ?? this.#timeouts.requestMs);
            await write(connection.get_output_stream(), encoded, cancellable);
            return await this.#readResponse(connection.get_input_stream(), cancellable);
        } catch (error) {
            return this.#classify(error, expired, cancellable);
        } finally {
            stopTimer();
            off();
            // Fire-and-forget on purpose: awaiting would delay the result, and a close error
            // cannot change an answer already in hand. The connection is unreferenced here, so
            // GLib finishes the close on its own.
            connection?.close_async(GLib.PRIORITY_DEFAULT, null).catch(() => undefined);
        }
    }

    async #readResponse(
        input: Gio.InputStream,
        cancellable: Gio.Cancellable,
    ): Promise<Result<HttpResponse, IncusError>> {
        const parser = new ResponseParser();
        for (;;) {
            const bytes = await input.read_bytes_async(
                MAX_READ_BYTES,
                GLib.PRIORITY_DEFAULT,
                cancellable,
            );
            const size = bytes.get_size();
            this.#onRead?.(size);
            const state = size === 0 ? parser.finish() : parser.push(bytes.toArray());
            if (state.kind === 'done') return ok(state.response);
            if (state.kind === 'error') return err(state.error);
        }
    }

    #classify(
        error: unknown,
        expired: boolean,
        cancellable: Gio.Cancellable,
    ): Result<never, IncusError> {
        if (expired) return failure('timeout');
        if (cancellable.is_cancelled()) return failure('cancelled');
        if (isIOError(error, Gio.IOErrorEnum.NOT_FOUND)) return failure('not-installed');
        if (isIOError(error, Gio.IOErrorEnum.PERMISSION_DENIED))
            return failure('permission-denied');
        if (error instanceof GLib.Error) return failure('unreachable');
        // Not a platform failure, so it is a bug worth a report; the port still must not reject.
        console.error(`Incus transport failed unexpectedly: ${String(error)}`);
        return err({ kind: 'protocol', detail: 'internal error' });
    }
}

/**
 * Writes with GLib.Bytes, which stay alive for the whole operation: a bare Uint8Array handed
 * to write_all_async can be moved by the garbage collector mid-write ("Bad address").
 */
async function write(
    output: Gio.OutputStream,
    data: Uint8Array,
    cancellable: Gio.Cancellable,
): Promise<void> {
    for (let sent = 0; sent < data.length;) {
        // A fresh copy of the unsent tail: GLib.Bytes.new_from_bytes is absent from GJS 1.80, and
        // a short write is rare, so the copy happens once in practice.
        const chunk = GLib.Bytes.new(data.subarray(sent));
        sent += await output.write_bytes_async(chunk, GLib.PRIORITY_DEFAULT, cancellable);
    }
}
