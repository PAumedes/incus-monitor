// SPDX-License-Identifier: GPL-2.0-or-later
// GioTransport against a scripted fake daemon on a real unix socket.
//
// Decisions pinned here: the connection closing before the response is complete is `protocol`
// (the peer answered with a truncated message), a socket file nobody listens on is `unreachable`,
// and `requestMs` is a total deadline for the whole exchange, not an idle timeout. A request may
// carry its own `timeoutMs`, which replaces `requestMs`; the transport knows no paths.
//
// Not testable here: the connect deadline by stalling a connect. On a unix socket a full backlog
// fails at once with EAGAIN instead of blocking, so the connect timer is observed through the
// delay of the GLib source the transport arms instead.
import GLib from 'gi://GLib';

import { GioTransport, TRANSPORT_TIMEOUTS } from '../../src/adapters/gio-transport.js';
import { CancelSource } from '../../src/core/cancel.js';
import type { IncusError } from '../../src/core/errors.js';
import type { HttpRequest } from '../../src/core/http/request.js';
import type { Result } from '../../src/core/result.js';
import type { HttpResponse } from '../../src/core/http/response.js';
import { FakeServer, response, type Script } from './fake-server.js';
import { assert, test } from './harness.js';
import {
    CountingSignal,
    collectingWarnings,
    eventually,
    sleep,
    trackingSources,
    withTempDir,
} from './support.js';

const GET_LIST: HttpRequest = { method: 'GET', path: '/1.0/instances' };
const JSON_OK = '{"type":"sync","status":"Success","status_code":200,"metadata":[]}';
const text = (body: Uint8Array): string => new TextDecoder().decode(body);

const timeoutKind = (result: Result<HttpResponse, IncusError>): string =>
    result.ok ? 'ok' : result.error.kind;

async function withServer<T>(
    script: Script,
    body: (server: FakeServer, dir: string) => Promise<T>,
): Promise<T> {
    return withTempDir(async dir => {
        const server = FakeServer.listen(`${dir}/unix.socket`, script);
        try {
            return await body(server, dir);
        } finally {
            server.stop();
        }
    });
}

const answer =
    (reply: string): Script =>
    async peer => {
        await peer.readRequest();
        await peer.write(reply);
    };

/** Reads the request, then holds the connection open until the server stops. */
const stall: Script = async peer => {
    await peer.readRequest();
    await peer.serverStopped;
};

const connected = (server: FakeServer): Promise<true> =>
    eventually(() => (server.connections === 1 ? true : undefined));

test('transport: the default timeouts are exactly a connect and a request deadline, connect shorter', () => {
    assert.deepEqual(Object.keys(TRANSPORT_TIMEOUTS).sort(), ['connectMs', 'requestMs']);
    assert.ok(TRANSPORT_TIMEOUTS.connectMs < TRANSPORT_TIMEOUTS.requestMs);
});

test('transport: returns status, headers and body of a successful response', () =>
    withServer(answer(response(JSON_OK)), async server => {
        const result = await new GioTransport(server.path).request(
            GET_LIST,
            new CancelSource().signal,
        );
        assert.ok(result.ok);
        assert.equal(result.value.status, 200);
        assert.equal(result.value.headers.get('content-type'), 'application/json');
        assert.equal(text(result.value.body), JSON_OK);
    }));

test('transport: sends the encoded request, including a JSON body', () => {
    let seen = '';
    return withServer(
        async peer => {
            seen = await peer.readRequest();
            await peer.write(response(JSON_OK));
        },
        async server => {
            await new GioTransport(server.path).request(
                {
                    method: 'PUT',
                    path: '/1.0/instances/web/state?project=default',
                    body: { action: 'stop' },
                },
                new CancelSource().signal,
            );
            assert.ok(seen.startsWith('PUT /1.0/instances/web/state?project=default HTTP/1.1\r\n'));
            assert.ok(seen.endsWith('{"action":"stop"}'));
        },
    );
});

test('transport: decodes a chunked response split across writes', () =>
    withServer(
        async peer => {
            await peer.readRequest();
            await peer.write('HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhel');
            await sleep(20);
            await peer.write('lo\r\n6\r\n world\r\n0\r\n\r\n');
        },
        async server => {
            const result = await new GioTransport(server.path).request(
                GET_LIST,
                new CancelSource().signal,
            );
            assert.ok(result.ok);
            assert.equal(text(result.value.body), 'hello world');
        },
    ));

test('transport: a read-to-EOF body completes when the server closes', () =>
    withServer(answer('HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nuntil eof'), async server => {
        const result = await new GioTransport(server.path).request(
            GET_LIST,
            new CancelSource().signal,
        );
        assert.ok(result.ok);
        assert.equal(text(result.value.body), 'until eof');
    }));

test('transport: a 1 MiB body arrives intact in reads of at most 64 KiB', () => {
    const big = `[${'"x",'.repeat(262143)}"x"]`;
    const reads: number[] = [];
    return withServer(answer(response(big)), async server => {
        const result = await new GioTransport(server.path, {
            onRead: bytes => reads.push(bytes),
        }).request(GET_LIST, new CancelSource().signal);
        assert.ok(result.ok);
        assert.equal(result.value.body.length, big.length);
        assert.equal(text(result.value.body), big);
        assert.ok(
            Math.max(...reads) <= 64 * 1024,
            `largest read was ${String(Math.max(...reads))}`,
        );
        assert.ok(reads.length >= 16, `only ${String(reads.length)} reads for 1 MiB`);
    });
});

test('transport: an API error status is a response, not a transport error', () =>
    withServer(
        answer(response('{"type":"error","error_code":404}', '404 Not Found')),
        async server => {
            const result = await new GioTransport(server.path).request(
                GET_LIST,
                new CancelSource().signal,
            );
            assert.ok(result.ok);
            assert.equal(result.value.status, 404);
        },
    ));

test('transport: a stalled server yields timeout after the request deadline', () =>
    withServer(stall, async server => {
        const result = await new GioTransport(server.path, {
            timeouts: { requestMs: 150 },
        }).request(GET_LIST, new CancelSource().signal);
        assert.equal(timeoutKind(result), 'timeout');
    }));

test('transport: the request deadline is total, so a slow drip cannot extend it', () =>
    withServer(
        async peer => {
            await peer.readRequest();
            await peer.write('HTTP/1.1 200 OK\r\nContent-Length: 1000\r\n\r\n');
            for (let i = 0; i < 100; i++) {
                await peer.write('x');
                await sleep(30);
            }
        },
        async server => {
            const result = await new GioTransport(server.path, {
                timeouts: { requestMs: 200 },
            }).request(GET_LIST, new CancelSource().signal);
            assert.equal(timeoutKind(result), 'timeout');
        },
    ));

const slowAnswer: Script = async peer => {
    await peer.readRequest();
    await sleep(300);
    // The client may have given up already; that is the point of some tests.
    await peer.write(response(JSON_OK)).catch(() => undefined);
};

test('transport: a request with its own timeoutMs succeeds at a delay above requestMs', () =>
    withServer(slowAnswer, async server => {
        const result = await new GioTransport(server.path, {
            timeouts: { requestMs: 100 },
        }).request({ ...GET_LIST, timeoutMs: 3000 }, new CancelSource().signal);
        assert.equal(timeoutKind(result), 'ok');
    }));

test('transport: the same delay without timeoutMs times out', () =>
    withServer(slowAnswer, async server => {
        const result = await new GioTransport(server.path, {
            timeouts: { requestMs: 100 },
        }).request(GET_LIST, new CancelSource().signal);
        assert.equal(timeoutKind(result), 'timeout');
    }));

test('transport: a request timeoutMs that is exceeded times out', () =>
    withServer(stall, async server => {
        const result = await new GioTransport(server.path, {
            timeouts: { requestMs: 5000 },
        }).request({ ...GET_LIST, timeoutMs: 150 }, new CancelSource().signal);
        assert.equal(timeoutKind(result), 'timeout');
    }));

test('transport: the transport has no special case for any path', () =>
    withServer(slowAnswer, async server => {
        const wait: HttpRequest = {
            method: 'GET',
            path: '/1.0/operations/6b3e0fd0-1c7a-4c3e-8d2f-0d3d6b9f2f11/wait?timeout=60',
        };
        const result = await new GioTransport(server.path, {
            timeouts: { requestMs: 100 },
        }).request(wait, new CancelSource().signal);
        assert.equal(timeoutKind(result), 'timeout');
    }));

test('transport: arms the connect deadline first, then requestMs or the request timeoutMs', () =>
    withServer(answer(response(JSON_OK)), async server => {
        const timeouts = { connectMs: 111, requestMs: 222 };
        const transport = new GioTransport(server.path, { timeouts });
        await trackingSources(async tracker => {
            await transport.request(GET_LIST, new CancelSource().signal);
            assert.deepEqual(tracker.intervals, [111, 222]);
        });
        await trackingSources(async tracker => {
            await transport.request({ ...GET_LIST, timeoutMs: 333 }, new CancelSource().signal);
            assert.deepEqual(tracker.intervals, [111, 333]);
        });
    }));

// A request timeoutMs outside what GLib accepts is clamped like GLibClock does: to
// [0, 2**31-1], with NaN as 0. It is never passed on raw, where a guint would wrap.
test('transport: a request timeoutMs outside the GLib range is clamped, never raw', () =>
    withServer(answer(response(JSON_OK)), async server => {
        const transport = new GioTransport(server.path, { timeouts: { connectMs: 111 } });
        const expected: [number, number][] = [
            [-1, 0],
            [NaN, 0],
            [0, 0],
            [-Infinity, 0],
            [2 ** 32, 2 ** 31 - 1],
            [Infinity, 2 ** 31 - 1],
        ];
        for (const [timeoutMs, armed] of expected) {
            await trackingSources(async tracker => {
                await transport.request({ ...GET_LIST, timeoutMs }, new CancelSource().signal);
                assert.deepEqual(tracker.intervals, [111, armed], `timeoutMs ${String(timeoutMs)}`);
            });
        }
    }));

test('transport: a degenerate request timeoutMs yields a timeout or a success, and logs nothing', () =>
    withServer(answer(response(JSON_OK)), async server => {
        const transport = new GioTransport(server.path);
        const warnings = await collectingWarnings(async () => {
            for (const timeoutMs of [-1, NaN, 0, 2 ** 32]) {
                const result = await transport.request(
                    { ...GET_LIST, timeoutMs },
                    new CancelSource().signal,
                );
                const kind = timeoutKind(result);
                assert.ok(
                    kind === 'ok' || kind === 'timeout',
                    `timeoutMs ${String(timeoutMs)} gave ${kind}`,
                );
                assert.ok(result.ok || result.error.kind !== 'protocol', 'protocol error');
            }
        });
        assert.deepEqual(warnings, []);
    }));

test('transport: the connection closing mid-body is a protocol error', () =>
    withServer(
        async peer => {
            await peer.readRequest();
            await peer.write('HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nshort');
        },
        async server => {
            const result = await new GioTransport(server.path).request(
                GET_LIST,
                new CancelSource().signal,
            );
            assert.ok(!result.ok);
            assert.equal(result.error.kind, 'protocol');
        },
    ));

test('transport: the connection closing before any response byte is a protocol error', () =>
    withServer(
        async peer => {
            await peer.readRequest();
        },
        async server => {
            const result = await new GioTransport(server.path).request(
                GET_LIST,
                new CancelSource().signal,
            );
            assert.equal(timeoutKind(result), 'protocol');
        },
    ));

test('transport: garbage instead of HTTP is a protocol error', () =>
    withServer(answer('not http at all\r\n\r\n'), async server => {
        const result = await new GioTransport(server.path).request(
            GET_LIST,
            new CancelSource().signal,
        );
        assert.equal(timeoutKind(result), 'protocol');
    }));

test('transport: a missing socket file is not-installed', () =>
    withTempDir(async dir => {
        const result = await new GioTransport(`${dir}/absent.socket`).request(
            GET_LIST,
            new CancelSource().signal,
        );
        assert.equal(timeoutKind(result), 'not-installed');
    }));

test('transport: a missing parent directory is not-installed', async () => {
    const result = await new GioTransport('/nonexistent-incus-dir/unix.socket').request(
        GET_LIST,
        new CancelSource().signal,
    );
    assert.equal(timeoutKind(result), 'not-installed');
});

test('transport: a socket the user may not open is permission-denied', () =>
    withServer(answer(response(JSON_OK)), async (server, dir) => {
        GLib.chmod(`${dir}/unix.socket`, 0o000);
        const result = await new GioTransport(server.path).request(
            GET_LIST,
            new CancelSource().signal,
        );
        assert.equal(timeoutKind(result), 'permission-denied');
        assert.equal(server.connections, 0);
    }));

test('transport: a socket file with no listener is unreachable', () =>
    withServer(answer(response(JSON_OK)), async server => {
        server.stop();
        const result = await new GioTransport(server.path).request(
            GET_LIST,
            new CancelSource().signal,
        );
        assert.equal(timeoutKind(result), 'unreachable');
    }));

test('transport: an unencodable request is a protocol error and never connects', () =>
    withServer(answer(response(JSON_OK)), async server => {
        const result = await new GioTransport(server.path).request(
            { method: 'GET', path: 'no-leading-slash' },
            new CancelSource().signal,
        );
        assert.equal(timeoutKind(result), 'protocol');
        assert.equal(server.connections, 0);
    }));

test('transport: an already cancelled signal is cancelled without connecting', () =>
    withServer(answer(response(JSON_OK)), async server => {
        const source = new CancelSource();
        source.cancel();
        const result = await new GioTransport(server.path).request(GET_LIST, source.signal);
        assert.equal(timeoutKind(result), 'cancelled');
        assert.equal(server.connections, 0);
    }));

test('transport: cancelling during connect is cancelled', () =>
    withServer(answer(response(JSON_OK)), async server => {
        const source = new CancelSource();
        const pending = new GioTransport(server.path).request(GET_LIST, source.signal);
        source.cancel();
        assert.equal(timeoutKind(await pending), 'cancelled');
    }));

test('transport: cancelling while waiting for the response is cancelled', () =>
    withServer(stall, async server => {
        const source = new CancelSource();
        const pending = new GioTransport(server.path).request(GET_LIST, source.signal);
        await connected(server);
        source.cancel();
        assert.equal(timeoutKind(await pending), 'cancelled');
    }));

test('transport: cancelling a write the server never drains is cancelled', () =>
    withServer(
        async peer => {
            await peer.serverStopped;
        },
        async server => {
            const source = new CancelSource();
            const body = { padding: 'x'.repeat(16 * 1024 * 1024) };
            const pending = new GioTransport(server.path).request(
                { method: 'PUT', path: '/1.0/instances/web/state', body },
                source.signal,
            );
            await connected(server);
            source.cancel();
            assert.equal(timeoutKind(await pending), 'cancelled');
        },
    ));

test('transport: cancelling mid-body is cancelled', () =>
    withServer(
        async peer => {
            await peer.readRequest();
            await peer.write('HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\nshort');
            await peer.serverStopped;
        },
        async server => {
            const source = new CancelSource();
            let received = 0;
            const pending = new GioTransport(server.path, {
                onRead: bytes => (received += bytes),
            }).request(GET_LIST, source.signal);
            await eventually(() => (received > 0 ? true : undefined));
            source.cancel();
            assert.equal(timeoutKind(await pending), 'cancelled');
        },
    ));

test('transport: the onCancel registration is removed after a success', () =>
    withServer(answer(response(JSON_OK)), async server => {
        const signal = new CountingSignal();
        const result = await new GioTransport(server.path).request(GET_LIST, signal);
        assert.ok(result.ok);
        assert.ok(signal.registrations >= 1, 'the transport must observe cancellation');
        assert.equal(signal.active, 0);
    }));

test('transport: the onCancel registration is removed after each failure kind', async () => {
    const signal = new CountingSignal();
    await withTempDir(async dir => {
        await new GioTransport(`${dir}/absent.socket`).request(GET_LIST, signal);
    });
    await new GioTransport('/nonexistent-incus-dir/x').request(
        { method: 'GET', path: 'bad' },
        signal,
    );
    await withServer(stall, async server => {
        await new GioTransport(server.path, { timeouts: { requestMs: 100 } }).request(
            GET_LIST,
            signal,
        );
    });
    assert.equal(signal.active, 0);
});

test('transport: many sequential requests on one signal leave no registrations behind', () =>
    withServer(answer(response(JSON_OK)), async server => {
        const signal = new CountingSignal();
        const transport = new GioTransport(server.path);
        for (let i = 0; i < 5; i++) await transport.request(GET_LIST, signal);
        assert.equal(signal.active, 0);
    }));

test('transport: a 4 MiB request body reaches a slow-reading server byte-complete', () => {
    const padding = 'x'.repeat(4 * 1024 * 1024);
    let seen = '';
    return withServer(
        async peer => {
            // Reading late forces the socket buffer to fill, so the client writes in pieces.
            await sleep(100);
            seen = await peer.readRequest();
            await peer.write(response(JSON_OK));
        },
        async server => {
            const result = await new GioTransport(server.path).request(
                { method: 'PUT', path: '/1.0/instances/web/state', body: { padding } },
                new CancelSource().signal,
            );
            assert.ok(result.ok);
            assert.ok(seen.endsWith(`{"padding":"${padding}"}`));
            assert.ok(seen.includes(`Content-Length: ${String(padding.length + 14)}\r\n`));
        },
    );
});

const SOURCE_SCENARIOS: readonly (readonly [string, Script])[] = [
    ['a successful response', answer(response(JSON_OK))],
    ['a protocol error', answer('not http at all\r\n\r\n')],
    ['a timeout', stall],
    ['a cancellation', stall],
];

for (const [name, script] of SOURCE_SCENARIOS) {
    test(`transport: no timer source outlives a request that ends in ${name}`, () =>
        withServer(script, async server => {
            await trackingSources(async tracker => {
                const source = new CancelSource();
                const pending = new GioTransport(server.path, {
                    timeouts: { connectMs: 150, requestMs: 150 },
                }).request(GET_LIST, source.signal);
                if (name === 'a cancellation') {
                    await connected(server);
                    source.cancel();
                }
                await pending;
                assert.equal(tracker.live(), 0);
            });
        }));
}

test('transport: no timer source outlives a request that fails to connect', () =>
    withTempDir(async dir => {
        await trackingSources(async tracker => {
            await new GioTransport(`${dir}/absent.socket`, {
                timeouts: { connectMs: 150, requestMs: 150 },
            }).request(GET_LIST, new CancelSource().signal);
            assert.equal(tracker.live(), 0);
        });
    }));

const CLOSING_SCENARIOS: readonly [string, (peer: Parameters<Script>[0]) => Promise<void>][] = [
    ['a response', peer => peer.write(response(JSON_OK))],
    ['a timeout', () => Promise.resolve()],
];

for (const [name, reply] of CLOSING_SCENARIOS) {
    test(`transport: the client closes its socket after ${name}`, async () => {
        let eof = 0;
        await withServer(
            async peer => {
                await peer.readRequest();
                await reply(peer);
                await peer.readToEof();
                eof++;
            },
            async server => {
                await new GioTransport(server.path, { timeouts: { requestMs: 150 } }).request(
                    GET_LIST,
                    new CancelSource().signal,
                );
                await eventually(() => (eof === 1 ? true : undefined), 2000);
            },
        );
    });
}
