// SPDX-License-Identifier: GPL-2.0-or-later
// A scripted fake Incus daemon on a real unix socket (Gio.SocketService).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

Gio._promisify(Gio.InputStream.prototype, 'read_bytes_async', 'read_bytes_finish');
Gio._promisify(Gio.OutputStream.prototype, 'write_bytes_async', 'write_bytes_finish');

const HEAD_END = '\r\n\r\n';

export interface Peer {
    /** Reads one request: the head and, when Content-Length is present, the body. */
    readRequest(): Promise<string>;
    write(data: string | Uint8Array): Promise<void>;
    /** Resolves when the whole server stops, so a script can idle without a timer. */
    readonly serverStopped: Promise<void>;
    /** Resolves once the client has closed its end (reads until end of stream). */
    readToEof(): Promise<void>;
    /** Closes the connection now (the server closes it anyway when the script returns). */
    close(): void;
}

export type Script = (peer: Peer) => Promise<void>;

export const response = (body: string, status = '200 OK'): string =>
    `HTTP/1.1 ${status}\r\nContent-Type: application/json\r\nContent-Length: ${String(new TextEncoder().encode(body).length)}\r\nConnection: close\r\n\r\n${body}`;

class ConnectionPeer implements Peer {
    constructor(
        readonly connection: Gio.SocketConnection,
        readonly serverStopped: Promise<void>,
    ) {}

    async readToEof(): Promise<void> {
        const input = this.connection.get_input_stream();
        while ((await input.read_bytes_async(65536, 0, null)).get_size() > 0) {
            // Discard: only the end of the stream matters.
        }
    }

    async readRequest(): Promise<string> {
        const input = this.connection.get_input_stream();
        const decoder = new TextDecoder();
        let text = '';
        for (;;) {
            const head = text.indexOf(HEAD_END);
            if (head >= 0) {
                const length = /content-length:\s*(\d+)/i.exec(text.slice(0, head));
                const wanted = head + HEAD_END.length + Number(length?.[1] ?? 0);
                if (new TextEncoder().encode(text).length >= wanted) return text;
            }
            const bytes = await input.read_bytes_async(65536, 0, null);
            if (bytes.get_size() === 0) return text;
            text += decoder.decode(bytes.toArray());
        }
    }

    async write(data: string | Uint8Array): Promise<void> {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        const output = this.connection.get_output_stream();
        // write_bytes_async keeps the GLib.Bytes alive for the whole operation and may write
        // only part of it, so loop until every byte is out.
        for (let sent = 0; sent < bytes.length;) {
            const chunk = GLib.Bytes.new(bytes.subarray(sent));
            sent += await output.write_bytes_async(chunk, 0, null);
        }
    }

    close(): void {
        try {
            this.connection.close(null);
        } catch {
            // Already closed by the client.
        }
    }
}

export class FakeServer {
    /** Connections accepted so far. */
    connections = 0;
    readonly #service = new Gio.SocketService();
    readonly #stopped: Promise<void>;
    #markStopped: () => void = () => undefined;

    private constructor(
        readonly path: string,
        script: Script,
    ) {
        this.#stopped = new Promise(resolve => {
            this.#markStopped = resolve;
        });
        this.#service.add_address(
            Gio.UnixSocketAddress.new(path),
            Gio.SocketType.STREAM,
            Gio.SocketProtocol.DEFAULT,
            null,
        );
        this.#service.connect('incoming', (_service, connection) => {
            this.connections++;
            const peer = new ConnectionPeer(connection, this.#stopped);
            script(peer)
                .catch((error: unknown) => {
                    printerr(`fake server script failed: ${String(error)}`);
                })
                .finally(() => {
                    peer.close();
                });
            return true;
        });
        this.#service.start();
    }

    /** Listens on `path`; `script` runs once per accepted connection. */
    static listen(path: string, script: Script): FakeServer {
        return new FakeServer(path, script);
    }

    /** Stops accepting. The socket file stays, so later connects are refused, not missing. */
    stop(): void {
        this.#service.stop();
        this.#service.close();
        this.#markStopped();
    }
}
