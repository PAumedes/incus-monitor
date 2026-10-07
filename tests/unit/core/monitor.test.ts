// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it, vi } from 'vitest';

import type { IncusError } from '../../../src/core/errors.js';
import type { IncusClient } from '../../../src/core/incus/client.js';
import type { Instance, InstanceStatus, Server } from '../../../src/core/incus/models.js';
import { REQUIRED_EXTENSIONS } from '../../../src/core/incus/compat.js';
import { knownInstances, Monitor, type Snapshot } from '../../../src/core/monitor.js';
import { err, ok } from '../../../src/core/result.js';
import { SYSTEM_SOCKET, USER_SOCKET } from '../../../src/core/socket.js';
import type { SocketAccess } from '../../../src/core/ports.js';
import { FakeClock, flush } from '../fakes/clock.js';
import { FakeSocketProbe } from '../fakes/socket-probe.js';

const SERVER: Server = { version: '6.0.5', apiExtensions: new Set(REQUIRED_EXTENSIONS) };
const REF = { project: 'default', name: 'web01' } as const;

const instance = (name: string, status: InstanceStatus, project = 'default'): Instance => ({
    project,
    name,
    type: 'container',
    status,
    state: null,
    forwards: [],
});

interface Deferred<T> {
    readonly promise: Promise<T>;
    resolve(value: T): void;
}
function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(r => {
        resolve = r;
    });
    return { promise, resolve };
}

interface Options {
    readonly status?: InstanceStatus;
    readonly interval?: number;
    readonly override?: string;
    readonly access?: Readonly<Record<string, SocketAccess>>;
    readonly onSnapshot?: (snapshot: Snapshot) => void;
}

/** A monitor over scripted fakes. Defaults: one usable system socket, one `web01`. */
function setup({ status = 'running', interval = 10, override, access, onSnapshot }: Options = {}) {
    const clock = new FakeClock();
    const snapshots: Snapshot[] = [];
    const log = { warn: vi.fn<(message: string) => void>() };
    const client = {
        server: vi.fn<IncusClient['server']>(() => Promise.resolve(ok(SERVER))),
        instances: vi.fn<IncusClient['instances']>(() =>
            Promise.resolve(ok([instance('web01', status)])),
        ),
        changeState: vi.fn<IncusClient['changeState']>(() =>
            Promise.resolve(ok({ path: '/1.0/operations/abc', project: 'default' })),
        ),
        wait: vi.fn<IncusClient['wait']>(() => Promise.resolve(ok(true as const))),
    };
    const connect = vi.fn<(socketPath: string) => typeof client>(() => client);
    const probe = new FakeSocketProbe(
        access ?? { [SYSTEM_SOCKET]: 'usable', [USER_SOCKET]: 'missing' },
    );
    const monitor = new Monitor({
        connect,
        probe,
        clock,
        settings: { refreshIntervalSeconds: interval, socketOverride: override },
        log,
        onSnapshot: s => {
            snapshots.push(s);
            onSnapshot?.(s);
        },
    });
    const kinds = () => snapshots.map(s => s.kind);
    return { clock, snapshots, kinds, log, client, connect, probe, monitor };
}

/** Starts and lets the first poll settle. */
async function started(options?: Options) {
    const world = setup(options);
    world.monitor.start();
    await flush();
    return world;
}

type World = ReturnType<typeof setup>;

/** Runs `body` while collecting unhandled rejections instead of letting the runner see them. */
async function collectingUnhandled(body: () => Promise<void>): Promise<unknown[]> {
    const saved = process.listeners('unhandledRejection');
    const seen: unknown[] = [];
    process.removeAllListeners('unhandledRejection');
    process.on('unhandledRejection', reason => seen.push(reason));
    try {
        await body();
        await flush();
    } finally {
        process.removeAllListeners('unhandledRejection');
        for (const listener of saved) process.on('unhandledRejection', listener);
    }
    return seen;
}

const instancesFlag = (calls: readonly (readonly unknown[])[]): unknown[] =>
    calls.map(call => call[0]);

describe('Monitor start and state transitions', () => {
    it('is idle and silent until started', () => {
        const { monitor, snapshots } = setup();
        expect(monitor.state).toStrictEqual({ kind: 'idle' });
        expect(snapshots).toStrictEqual([]);
    });

    interface Transition {
        readonly name: string;
        readonly options?: Options;
        readonly prepare?: (world: World) => void;
        readonly act?: (world: World) => Promise<void>;
        readonly kinds: readonly Snapshot['kind'][];
    }
    const transitions: Transition[] = [
        { name: 'a healthy daemon', kinds: ['connecting', 'ready'] },
        {
            name: 'the next scheduled poll',
            act: async ({ clock }) => {
                clock.advance(10_000);
                await flush();
            },
            kinds: ['connecting', 'ready', 'refreshing', 'ready'],
        },
        {
            name: 'no socket at all',
            options: { access: { [SYSTEM_SOCKET]: 'missing', [USER_SOCKET]: 'missing' } },
            kinds: ['connecting', 'failed'],
        },
        {
            name: 'a failure followed by the retry',
            prepare: ({ client }) =>
                client.instances.mockResolvedValueOnce(err({ kind: 'timeout' })),
            act: async ({ clock }) => {
                clock.advance(2000);
                await flush();
            },
            kinds: ['connecting', 'failed', 'ready'],
        },
    ];

    it.each(transitions)('emits $kinds for $name', async ({ options, prepare, act, kinds }) => {
        const world = setup(options);
        prepare?.(world);
        world.monitor.start();
        await flush();
        await act?.(world);
        expect(world.kinds()).toStrictEqual(kinds);
        expect(world.monitor.state.kind).toBe(kinds[kinds.length - 1]);
    });

    it('reports the instances and the clock time in ready', async () => {
        const { monitor } = await started();
        expect(monitor.state).toStrictEqual({
            kind: 'ready',
            instances: [instance('web01', 'running')],
            atMs: 0,
        });
    });

    it('exposes through state the last snapshot passed to onSnapshot', async () => {
        const { monitor, snapshots } = await started();
        expect(monitor.state).toBe(snapshots[snapshots.length - 1]);
    });

    it('carries the previous instances in refreshing', async () => {
        const { clock, snapshots } = await started();
        clock.advance(10_000);
        await flush();
        expect(snapshots[2]).toStrictEqual({
            kind: 'refreshing',
            previous: [instance('web01', 'running')],
        });
    });

    it('connects with the discovered socket and checks the server once', async () => {
        const { connect, client, clock } = await started({
            access: { [SYSTEM_SOCKET]: 'missing', [USER_SOCKET]: 'usable' },
        });
        clock.advance(30_000);
        await flush();
        expect(connect.mock.calls).toStrictEqual([[USER_SOCKET]]);
        expect(client.server).toHaveBeenCalledTimes(1);
    });

    it('uses only the override socket when one is configured', async () => {
        const { connect, probe } = await started({
            override: '/run/custom.sock',
            access: { '/run/custom.sock': 'usable' },
        });
        expect(probe.calls).toStrictEqual(['/run/custom.sock']);
        expect(connect.mock.calls).toStrictEqual([['/run/custom.sock']]);
    });
});

describe('Monitor failures and back-off', () => {
    const connectionKinds = [
        'not-installed',
        'permission-denied',
        'unreachable',
        'timeout',
    ] as const;

    it('fails with not-installed and a 2 s retry when no socket exists', async () => {
        const { monitor } = await started({
            access: { [SYSTEM_SOCKET]: 'missing', [USER_SOCKET]: 'missing' },
        });
        expect(monitor.state).toStrictEqual({
            kind: 'failed',
            error: { kind: 'not-installed' },
            retryInMs: 2000,
        });
    });

    it('fails with permission-denied when the only socket is denied', async () => {
        const { monitor } = await started({
            access: { [SYSTEM_SOCKET]: 'denied', [USER_SOCKET]: 'missing' },
        });
        expect(monitor.state).toMatchObject({
            kind: 'failed',
            error: { kind: 'permission-denied' },
        });
    });

    it('doubles the retry delay up to a 60 s cap', async () => {
        const { monitor, clock } = await started({
            access: { [SYSTEM_SOCKET]: 'missing', [USER_SOCKET]: 'missing' },
        });
        const delays: number[] = [];
        for (let i = 0; i < 8; i++) {
            if (monitor.state.kind !== 'failed') throw new Error('expected failed');
            delays.push(monitor.state.retryInMs);
            clock.advance(monitor.state.retryInMs);
            await flush();
        }
        expect(delays).toStrictEqual([2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000, 60_000]);
    });

    it('does not retry before the delay has elapsed', async () => {
        const { clock, probe } = await started({
            access: { [SYSTEM_SOCKET]: 'missing', [USER_SOCKET]: 'missing' },
        });
        const before = probe.calls.length;
        clock.advance(1999);
        await flush();
        expect(probe.calls.length).toBe(before);
    });

    it('resets the back-off after a success', async () => {
        const { monitor, clock, client } = await started();
        client.instances.mockResolvedValueOnce(err({ kind: 'timeout' }));
        client.instances.mockResolvedValueOnce(err({ kind: 'timeout' }));
        clock.advance(10_000);
        await flush();
        clock.advance(2000);
        await flush();
        expect(monitor.state).toMatchObject({ kind: 'failed', retryInMs: 4000 });
        clock.advance(4000);
        await flush();
        expect(monitor.state.kind).toBe('ready');
        client.instances.mockResolvedValueOnce(err({ kind: 'timeout' }));
        clock.advance(10_000);
        await flush();
        expect(monitor.state).toMatchObject({ kind: 'failed', retryInMs: 2000 });
    });

    it('recovers to ready when the socket appears later', async () => {
        const { monitor, clock, probe } = await started({
            access: { [SYSTEM_SOCKET]: 'missing', [USER_SOCKET]: 'missing' },
        });
        expect(monitor.state.kind).toBe('failed');
        // The fake probe answers from a fixed table, so a late socket is a new answer.
        Object.assign(probe, { access: () => Promise.resolve('usable' as const) });
        clock.advance(2000);
        await flush();
        expect(monitor.state.kind).toBe('ready');
    });

    it.each(connectionKinds)('re-runs socket discovery after a %s failure', async kind => {
        const { clock, probe, client } = await started();
        client.instances.mockResolvedValueOnce(err({ kind }));
        clock.advance(10_000);
        await flush();
        const before = probe.calls.length;
        clock.advance(2000);
        await flush();
        expect(probe.calls.length).toBeGreaterThan(before);
    });

    it('checks server compatibility again after reconnecting', async () => {
        const { clock, client } = await started();
        client.instances.mockResolvedValueOnce(err({ kind: 'unreachable' }));
        clock.advance(10_000);
        await flush();
        clock.advance(2000);
        await flush();
        expect(client.server).toHaveBeenCalledTimes(2);
    });

    it.each<IncusError>([
        { kind: 'protocol', detail: 'bad' },
        { kind: 'decode', path: '$', detail: 'bad' },
        { kind: 'api', code: 500, message: 'boom' },
    ])('retries without rediscovery after a $kind failure', async error => {
        const { clock, probe, client, monitor } = await started();
        client.instances.mockResolvedValueOnce(err(error));
        clock.advance(10_000);
        await flush();
        const before = probe.calls.length;
        clock.advance(2000);
        await flush();
        expect(probe.calls.length).toBe(before);
        expect(monitor.state.kind).toBe('ready');
    });

    it('treats an unsupported server as failed with a fixed 60 s retry and no rediscovery storm', async () => {
        const { monitor, client, clock } = setup();
        client.server.mockResolvedValue(ok({ version: '5.0', apiExtensions: new Set<string>() }));
        monitor.start();
        await flush();
        expect(monitor.state).toMatchObject({
            kind: 'failed',
            error: { kind: 'unsupported' },
            retryInMs: 60_000,
        });
        clock.advance(60_000);
        await flush();
        expect(monitor.state).toMatchObject({ kind: 'failed', retryInMs: 60_000 });
        expect(client.instances).not.toHaveBeenCalled();
    });

    it('fails when the server request fails, then rechecks compatibility on the retry', async () => {
        const { monitor, client, clock } = setup();
        client.server.mockResolvedValueOnce(err({ kind: 'unreachable' }));
        monitor.start();
        await flush();
        expect(monitor.state).toMatchObject({ kind: 'failed', error: { kind: 'unreachable' } });
        clock.advance(2000);
        await flush();
        expect(monitor.state.kind).toBe('ready');
        expect(client.server).toHaveBeenCalledTimes(2);
    });
});

describe('Monitor cadence', () => {
    it('polls without state every refresh-interval while the menu is closed', async () => {
        const { clock, client } = await started({ interval: 7 });
        clock.advance(6999);
        await flush();
        expect(client.instances).toHaveBeenCalledTimes(1);
        clock.advance(1);
        await flush();
        expect(instancesFlag(client.instances.mock.calls)).toStrictEqual([false, false]);
    });

    it('refreshes at once with state when the menu opens', async () => {
        const { monitor, client } = await started();
        monitor.setMenuOpen(true);
        await flush();
        expect(instancesFlag(client.instances.mock.calls)).toStrictEqual([false, true]);
    });

    it('polls with state every 2 s while the menu is open', async () => {
        const { monitor, clock, client } = await started();
        monitor.setMenuOpen(true);
        await flush();
        clock.advance(2000);
        await flush();
        clock.advance(2000);
        await flush();
        expect(instancesFlag(client.instances.mock.calls)).toStrictEqual([false, true, true, true]);
    });

    it('returns to the slow cadence without state when the menu closes', async () => {
        const { monitor, clock, client } = await started();
        monitor.setMenuOpen(true);
        await flush();
        monitor.setMenuOpen(false);
        clock.advance(2000);
        await flush();
        expect(client.instances).toHaveBeenCalledTimes(2);
        clock.advance(8000);
        await flush();
        expect(instancesFlag(client.instances.mock.calls)).toStrictEqual([false, true, false]);
    });

    it('does not poll twice per interval after the menu flips closed then open', async () => {
        const { monitor, clock, client } = await started();
        monitor.setMenuOpen(true);
        await flush();
        monitor.setMenuOpen(false);
        monitor.setMenuOpen(true);
        await flush();
        const before = client.instances.mock.calls.length;
        clock.advance(2000);
        await flush();
        expect(client.instances.mock.calls.length).toBe(before + 1);
    });

    it.each([0, -1, Number.NaN, 0.5])(
        'never polls a closed menu faster than every 2 s when the interval is %s',
        async interval => {
            const { clock, client } = await started({ interval });
            clock.advance(1999);
            await flush();
            expect(client.instances).toHaveBeenCalledTimes(1);
            clock.advance(58_001);
            await flush();
            expect(client.instances.mock.calls.length).toBeGreaterThan(1);
        },
    );

    it('makes one request when the menu is opened twice', async () => {
        const { monitor, client } = await started();
        monitor.setMenuOpen(true);
        monitor.setMenuOpen(true);
        await flush();
        expect(client.instances).toHaveBeenCalledTimes(2);
    });

    it('makes one request when started twice', async () => {
        const { monitor, client } = setup();
        monitor.start();
        monitor.start();
        await flush();
        expect(client.instances).toHaveBeenCalledTimes(1);
    });

    it('makes no request on refresh() or setMenuOpen(true) before start', async () => {
        const { monitor, client, probe, clock } = setup();
        monitor.refresh();
        monitor.setMenuOpen(true);
        await flush();
        expect(probe.calls).toStrictEqual([]);
        expect(client.server).not.toHaveBeenCalled();
        expect(client.instances).not.toHaveBeenCalled();
        expect(clock.pending).toBe(0);
    });

    it('stamps ready with the clock time of the poll', async () => {
        const { monitor, clock } = await started();
        clock.advance(10_000);
        await flush();
        expect(monitor.state).toMatchObject({ kind: 'ready', atMs: clock.now() });
        expect(clock.now()).toBe(10_000);
    });

    it('refresh() polls immediately', async () => {
        const { monitor, client } = await started();
        monitor.refresh();
        await flush();
        expect(client.instances).toHaveBeenCalledTimes(2);
    });
});

describe('Monitor single request in flight', () => {
    async function inFlight() {
        const world = setup();
        const pending = deferred<Awaited<ReturnType<IncusClient['instances']>>>();
        world.client.instances.mockReturnValueOnce(pending.promise);
        world.monitor.start();
        await flush();
        return { ...world, pending };
    }

    it('schedules the next poll only after the previous settles', async () => {
        const { clock, client, pending } = await inFlight();
        clock.advance(60_000);
        await flush();
        expect(client.instances).toHaveBeenCalledTimes(1);
        expect(clock.pending).toBe(0);
        pending.resolve(ok([]));
        await flush();
        expect(clock.pending).toBe(1);
    });

    it('does not start a second request on refresh() while one is in flight', async () => {
        const { monitor, client } = await inFlight();
        monitor.refresh();
        await flush();
        expect(client.instances).toHaveBeenCalledTimes(1);
    });

    it('polls with state right after the in-flight request settles when the menu opens meanwhile', async () => {
        const { monitor, client, pending } = await inFlight();
        monitor.setMenuOpen(true);
        await flush();
        expect(client.instances).toHaveBeenCalledTimes(1);
        pending.resolve(ok([]));
        await flush();
        expect(instancesFlag(client.instances.mock.calls)).toStrictEqual([false, true]);
    });
});

describe('Monitor perform', () => {
    const table: [InstanceStatus, 'start' | 'stop' | 'restart' | 'freeze' | 'unfreeze', boolean][] =
        [
            ['stopped', 'start', true],
            ['running', 'start', false],
            ['frozen', 'start', false],
            ['running', 'stop', true],
            ['stopped', 'stop', false],
            ['frozen', 'stop', true],
            ['running', 'restart', true],
            ['stopped', 'restart', false],
            ['running', 'freeze', true],
            ['frozen', 'freeze', false],
            ['stopped', 'freeze', false],
            ['frozen', 'unfreeze', true],
            ['running', 'unfreeze', false],
            ['stopped', 'unfreeze', false],
            ['busy', 'stop', false],
            ['error', 'start', false],
            ['unknown', 'start', false],
        ];

    it.each(table)('with status %s, %s is allowed: %s', async (status, action, allowed) => {
        const { monitor, client } = await started({ status });
        const result = await monitor.perform(action, REF);
        expect(result.ok).toBe(allowed);
        expect(client.changeState).toHaveBeenCalledTimes(allowed ? 1 : 0);
        if (!allowed) expect(result).toMatchObject({ error: { kind: 'unsupported' } });
    });

    it('rejects an instance missing from the snapshot without calling the API', async () => {
        const { monitor, client } = await started();
        const result = await monitor.perform('stop', { project: 'default', name: 'ghost' });
        expect(result).toMatchObject({ ok: false, error: { kind: 'unsupported' } });
        expect(client.changeState).not.toHaveBeenCalled();
    });

    it('rejects before the first snapshot without calling the API', async () => {
        const { monitor, client } = setup();
        const result = await monitor.perform('stop', REF);
        expect(result).toMatchObject({ ok: false, error: { kind: 'unsupported' } });
        expect(client.changeState).not.toHaveBeenCalled();
    });

    it('performs an action while a refresh is in flight', async () => {
        const { monitor, client, clock } = await started();
        client.instances.mockReturnValueOnce(new Promise(() => undefined));
        clock.advance(10_000);
        await flush();
        expect(monitor.state.kind).toBe('refreshing');
        void monitor.perform('stop', REF);
        await flush();
        expect(client.changeState).toHaveBeenCalledTimes(1);
    });

    it('changes state, waits for the operation, refreshes, then returns ok', async () => {
        const { monitor, client } = await started();
        const result = await monitor.perform('stop', REF);
        expect(result).toStrictEqual(ok(true));
        expect(client.changeState.mock.calls[0]?.slice(0, 2)).toStrictEqual([REF, 'stop']);
        expect(client.wait.mock.calls[0]?.[0]).toStrictEqual({
            path: '/1.0/operations/abc',
            project: 'default',
        });
        expect(client.instances).toHaveBeenCalledTimes(2);
    });

    it('does not resolve before the refresh after the action has settled', async () => {
        const { monitor, client } = await started();
        const refresh = deferred<Awaited<ReturnType<IncusClient['instances']>>>();
        client.instances.mockReturnValueOnce(refresh.promise);
        const done = vi.fn();
        void monitor.perform('stop', REF).then(done);
        await flush();
        expect(done).not.toHaveBeenCalled();
        refresh.resolve(ok([instance('web01', 'stopped')]));
        await flush();
        expect(done).toHaveBeenCalledTimes(1);
        expect(monitor.state).toMatchObject({ kind: 'ready', instances: [{ status: 'stopped' }] });
    });

    it('returns the error of a failed state change without waiting', async () => {
        const { monitor, client } = await started();
        const error: IncusError = { kind: 'api', code: 409, message: 'busy' };
        client.changeState.mockResolvedValueOnce(err(error));
        expect(await monitor.perform('stop', REF)).toStrictEqual(err(error));
        expect(client.wait).not.toHaveBeenCalled();
    });

    it('returns the error of a failed wait and still refreshes', async () => {
        const { monitor, client } = await started();
        const error: IncusError = { kind: 'api', code: 400, message: 'failed' };
        client.wait.mockResolvedValueOnce(err(error));
        expect(await monitor.perform('stop', REF)).toStrictEqual(err(error));
        expect(client.instances).toHaveBeenCalledTimes(2);
    });

    it('treats a cancelled wait after a successful state change as ok and refreshes', async () => {
        const { monitor, client } = await started();
        client.wait.mockResolvedValueOnce(err({ kind: 'cancelled' }));
        expect(await monitor.perform('stop', REF)).toStrictEqual(ok(true));
        expect(client.instances).toHaveBeenCalledTimes(2);
    });

    it('returns cancelled when the state change itself was cancelled', async () => {
        const { monitor, client } = await started();
        client.changeState.mockResolvedValueOnce(err({ kind: 'cancelled' }));
        expect(await monitor.perform('stop', REF)).toStrictEqual(err({ kind: 'cancelled' }));
        expect(client.wait).not.toHaveBeenCalled();
    });

    it('serialises actions on the same instance', async () => {
        const { monitor, client } = await started();
        const first = deferred<Awaited<ReturnType<IncusClient['changeState']>>>();
        client.changeState.mockReturnValueOnce(first.promise);
        void monitor.perform('restart', REF);
        void monitor.perform('restart', REF);
        await flush();
        expect(client.changeState).toHaveBeenCalledTimes(1);
        first.resolve(ok({ path: '/1.0/operations/abc', project: 'default' }));
        await flush();
        expect(client.changeState).toHaveBeenCalledTimes(2);
    });

    it('runs actions on different instances concurrently', async () => {
        const { monitor, client } = await started();
        client.instances.mockResolvedValue(
            ok([instance('web01', 'running'), instance('db01', 'running')]),
        );
        monitor.refresh();
        await flush();
        const first = deferred<Awaited<ReturnType<IncusClient['changeState']>>>();
        client.changeState.mockReturnValueOnce(first.promise);
        void monitor.perform('restart', REF);
        void monitor.perform('restart', { project: 'default', name: 'db01' });
        await flush();
        expect(client.changeState).toHaveBeenCalledTimes(2);
    });

    it('keys serialisation by project as well as name', async () => {
        const { monitor, client } = await started();
        client.instances.mockResolvedValue(
            ok([instance('web01', 'running'), instance('web01', 'running', 'other')]),
        );
        monitor.refresh();
        await flush();
        const first = deferred<Awaited<ReturnType<IncusClient['changeState']>>>();
        client.changeState.mockReturnValueOnce(first.promise);
        void monitor.perform('restart', REF);
        void monitor.perform('restart', { project: 'other', name: 'web01' });
        await flush();
        expect(client.changeState).toHaveBeenCalledTimes(2);
    });

    it('resolves a queued action against the status after the previous action', async () => {
        const { monitor, client } = await started();
        client.instances.mockResolvedValueOnce(ok([instance('web01', 'stopped')]));
        const first = monitor.perform('stop', REF);
        const second = monitor.perform('stop', REF);
        await flush();
        expect(await first).toStrictEqual(ok(true));
        expect(await second).toMatchObject({ ok: false, error: { kind: 'unsupported' } });
        expect(client.changeState).toHaveBeenCalledTimes(1);
    });
});

describe('Monitor dispose', () => {
    it('clears every timer', async () => {
        const { monitor, clock } = await started();
        monitor.setMenuOpen(true);
        await flush();
        monitor.dispose();
        expect(clock.pending).toBe(0);
    });

    it('fires no snapshot after dispose, even when a request settles later', async () => {
        const { monitor, client, snapshots } = setup();
        const pending = deferred<Awaited<ReturnType<IncusClient['instances']>>>();
        client.instances.mockReturnValueOnce(pending.promise);
        monitor.start();
        await flush();
        const before = snapshots.length;
        monitor.dispose();
        pending.resolve(ok([instance('web01', 'running')]));
        await flush();
        expect(snapshots.length).toBe(before);
    });

    it('logs nothing and schedules nothing when a failure settles after dispose', async () => {
        const { monitor, client, log, clock } = setup();
        const pending = deferred<Awaited<ReturnType<IncusClient['instances']>>>();
        client.instances.mockReturnValueOnce(pending.promise);
        monitor.start();
        await flush();
        monitor.dispose();
        pending.resolve(err({ kind: 'protocol', detail: 'late' }));
        await flush();
        expect(log.warn).not.toHaveBeenCalled();
        expect(clock.pending).toBe(0);
    });

    it('cancels the signal handed to the client', async () => {
        const { monitor, client } = await started();
        const signal = client.instances.mock.calls[0]?.[1];
        expect(signal?.cancelled).toBe(false);
        monitor.dispose();
        expect(signal?.cancelled).toBe(true);
    });

    it('uses one signal for the whole lifetime', async () => {
        const { clock, client } = await started();
        clock.advance(10_000);
        await flush();
        const [first, second] = client.instances.mock.calls.map(call => call[1]);
        expect(first).toBe(second);
    });

    it('ignores start, refresh and setMenuOpen after dispose', async () => {
        const { monitor, client, clock, snapshots } = await started();
        monitor.dispose();
        const before = snapshots.length;
        monitor.start();
        monitor.setMenuOpen(true);
        monitor.refresh();
        await flush();
        expect(client.instances).toHaveBeenCalledTimes(1);
        expect(snapshots.length).toBe(before);
        expect(clock.pending).toBe(0);
    });

    it('returns ok for an action whose wait was cut off by dispose, with no refresh', async () => {
        const { monitor, client } = await started();
        const wait = deferred<Awaited<ReturnType<IncusClient['wait']>>>();
        client.wait.mockReturnValueOnce(wait.promise);
        const result = monitor.perform('stop', REF);
        await flush();
        monitor.dispose();
        wait.resolve(err({ kind: 'cancelled' }));
        expect(await result).toStrictEqual(ok(true));
        expect(client.instances).toHaveBeenCalledTimes(1);
    });
});

describe('Monitor dispose edge cases', () => {
    it('resolves perform after dispose with cancelled and no API call', async () => {
        const { monitor, client } = await started();
        monitor.dispose();
        expect(await monitor.perform('stop', REF)).toStrictEqual(err({ kind: 'cancelled' }));
        expect(client.changeState).not.toHaveBeenCalled();
    });

    it('resolves an action queued behind another with cancelled once disposed', async () => {
        const { monitor, client } = await started();
        const first = deferred<Awaited<ReturnType<IncusClient['changeState']>>>();
        client.changeState.mockReturnValueOnce(first.promise);
        void monitor.perform('restart', REF);
        const second = monitor.perform('restart', REF);
        await flush();
        monitor.dispose();
        first.resolve(ok({ path: '/1.0/operations/abc', project: 'default' }));
        expect(await second).toStrictEqual(err({ kind: 'cancelled' }));
        expect(client.changeState).toHaveBeenCalledTimes(1);
    });

    it('tolerates dispose twice', async () => {
        const { monitor } = await started();
        monitor.dispose();
        expect(() => {
            monitor.dispose();
        }).not.toThrow();
    });

    it('makes no instances call when disposed during the server check', async () => {
        const { monitor, client } = setup();
        const pending = deferred<Awaited<ReturnType<IncusClient['server']>>>();
        client.server.mockReturnValueOnce(pending.promise);
        monitor.start();
        await flush();
        monitor.dispose();
        pending.resolve(ok(SERVER));
        await flush();
        expect(client.instances).not.toHaveBeenCalled();
    });
});

describe('Monitor cancelled results', () => {
    it('stays silent when the cancelled result settles after dispose', async () => {
        const { monitor, client, log, clock, kinds } = setup();
        const pending = deferred<Awaited<ReturnType<IncusClient['instances']>>>();
        client.instances.mockReturnValueOnce(pending.promise);
        monitor.start();
        await flush();
        monitor.dispose();
        pending.resolve(err({ kind: 'cancelled' }));
        await flush();
        expect(kinds()).not.toContain('failed');
        expect(log.warn).not.toHaveBeenCalled();
        expect(clock.pending).toBe(0);
    });

    it.each(['server', 'instances'] as const)(
        'treats a cancelled %s result on a live monitor as unreachable and retries',
        async method => {
            const { monitor, client, clock, log } = setup();
            client[method].mockResolvedValueOnce(err({ kind: 'cancelled' }));
            monitor.start();
            await flush();
            expect(monitor.state).toStrictEqual({
                kind: 'failed',
                error: { kind: 'unreachable' },
                retryInMs: 2000,
            });
            expect(log.warn).not.toHaveBeenCalled();
            clock.advance(2000);
            await flush();
            expect(monitor.state.kind).toBe('ready');
        },
    );
});

describe('Monitor broken ports', () => {
    const breaks = {
        reject: (mock: { mockRejectedValueOnce(e: Error): unknown }, e: Error) =>
            mock.mockRejectedValueOnce(e),
        throw: (mock: { mockImplementationOnce(f: () => never): unknown }, e: Error) =>
            mock.mockImplementationOnce(() => {
                throw e;
            }),
    };

    it.each([
        ['server', 'reject'],
        ['server', 'throw'],
        ['instances', 'reject'],
        ['instances', 'throw'],
    ] as const)(
        'turns a %s port that does %s into failed protocol and one warning',
        async (method, how) => {
            const { monitor, client, log } = setup();
            breaks[how](client[method], new Error('contract break'));
            const seen = await collectingUnhandled(async () => {
                monitor.start();
                await flush();
            });
            expect(seen).toStrictEqual([]);
            expect(monitor.state).toMatchObject({ kind: 'failed', error: { kind: 'protocol' } });
            expect(log.warn).toHaveBeenCalledTimes(1);
            expect(log.warn.mock.calls[0]?.[0]).toContain('contract break');
        },
    );

    it('warns once while the port keeps breaking', async () => {
        const { monitor, client, log, clock } = setup();
        client.instances.mockRejectedValue(new Error('contract break'));
        monitor.start();
        await flush();
        for (const delay of [2000, 4000]) {
            clock.advance(delay);
            await flush();
        }
        expect(log.warn).toHaveBeenCalledTimes(1);
    });

    it('sanitises the thrown text before logging it', async () => {
        const { monitor, client, log } = setup();
        client.instances.mockRejectedValueOnce(new Error('a\u202eb\u0007c'));
        monitor.start();
        await flush();
        const message = log.warn.mock.calls[0]?.[0] ?? '';
        expect(message).toContain('a b c');
    });

    it('swallows a rejection that arrives after dispose', async () => {
        const { monitor, client, log } = setup();
        const pending = deferred<Awaited<ReturnType<IncusClient['instances']>>>();
        client.instances.mockReturnValueOnce(
            pending.promise.then(() => {
                throw new Error('late contract break');
            }),
        );
        monitor.start();
        await flush();
        monitor.dispose();
        pending.resolve(ok([]));
        await flush();
        expect(log.warn).not.toHaveBeenCalled();
    });

    it.each(['reject', 'throw'] as const)(
        'resolves perform with a protocol error and a warning when changeState does %s',
        async how => {
            const { monitor, client, log } = await started();
            breaks[how](client.changeState, new Error('contract break'));
            expect(await monitor.perform('stop', REF)).toMatchObject({
                ok: false,
                error: { kind: 'protocol' },
            });
            expect(log.warn).toHaveBeenCalledTimes(1);
            expect(log.warn.mock.calls[0]?.[0]).toContain('contract break');
        },
    );
});

describe('Monitor throwing callbacks', () => {
    interface Scenario {
        readonly name: string;
        readonly arrange: (world: World) => void;
        readonly options?: () => Options;
    }
    const throwOnce = (): ((s: Snapshot) => void) => {
        let thrown = false;
        return () => {
            if (thrown) return;
            thrown = true;
            throw new Error('callback break');
        };
    };
    const scenarios: Scenario[] = [
        {
            name: 'the first onSnapshot',
            arrange: () => undefined,
            options: () => ({ onSnapshot: throwOnce() }),
        },
        {
            name: 'the onSnapshot of the ready emit',
            arrange: () => undefined,
            options: () => {
                const once = throwOnce();
                return {
                    onSnapshot: s => {
                        if (s.kind === 'ready') once(s);
                    },
                };
            },
        },
    ];

    it.each(scenarios)('keeps polling after $name throws, via the clock', async scenario => {
        const world = setup(scenario.options?.());
        scenario.arrange(world);
        const seen = await collectingUnhandled(async () => {
            world.monitor.start();
            await flush();
            for (let i = 0; i < 3; i++) {
                world.clock.advance(10_000);
                await flush();
            }
        });
        expect(seen).toStrictEqual([]);
        expect(world.monitor.state.kind).toBe('ready');
        expect(world.client.instances.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it.each(scenarios)('keeps polling after $name throws, via refresh()', async scenario => {
        const world = setup(scenario.options?.());
        scenario.arrange(world);
        const seen = await collectingUnhandled(async () => {
            world.monitor.start();
            await flush();
            world.monitor.refresh();
            await flush();
            world.monitor.refresh();
            await flush();
        });
        expect(seen).toStrictEqual([]);
        expect(world.monitor.state.kind).toBe('ready');
    });
});

describe('Monitor logging', () => {
    const fail = async (detail: string) => {
        const world = await started();
        world.client.instances.mockResolvedValueOnce(err({ kind: 'protocol', detail }));
        world.clock.advance(10_000);
        await flush();
        return world;
    };

    it('warns once with the protocol detail', async () => {
        const { log } = await fail('truncated body');
        expect(log.warn).toHaveBeenCalledTimes(1);
        expect(log.warn.mock.calls[0]?.[0]).toContain('truncated body');
    });

    it('warns once across repeated failures, not once per poll', async () => {
        const { log, client, clock } = await fail('truncated body');
        client.instances.mockResolvedValue(err({ kind: 'protocol', detail: 'truncated body' }));
        for (const delay of [2000, 4000, 8000]) {
            clock.advance(delay);
            await flush();
        }
        expect(log.warn).toHaveBeenCalledTimes(1);
    });

    it('warns again when a new failure follows a success', async () => {
        const { log, client, clock } = await fail('first');
        clock.advance(2000);
        await flush();
        client.instances.mockResolvedValueOnce(err({ kind: 'protocol', detail: 'second' }));
        clock.advance(10_000);
        await flush();
        expect(log.warn).toHaveBeenCalledTimes(2);
        expect(log.warn.mock.calls[1]?.[0]).toContain('second');
    });

    it('replaces controls, line separators and bidi overrides with a space', async () => {
        const hostile = [0x07, 0x85, 0x2028, 0x2029, 0x202e, 0x2066, 0x7f, 0x0a];
        const raw = hostile.map(code => String.fromCodePoint(code));
        const { log } = await fail(raw.map((ch, i) => `${String(i + 1)}${ch}`).join('') + '9');
        const message = log.warn.mock.calls[0]?.[0] ?? '';
        expect(message).toContain('1 2 3 4 5 6 7 8 9');
        expect(raw.filter(ch => message.includes(ch))).toStrictEqual([]);
    });

    it.each<IncusError>([
        { kind: 'unreachable' },
        { kind: 'not-installed' },
        { kind: 'permission-denied' },
        { kind: 'cancelled' },
        { kind: 'unsupported', reason: 'secret detail' },
    ])('does not log a $kind failure', async error => {
        const { client, clock, log, monitor } = await started();
        client.instances.mockResolvedValueOnce(err(error));
        clock.advance(10_000);
        await flush();
        expect(monitor.state.kind).toBe('failed');
        expect(log.warn).not.toHaveBeenCalled();
    });

    describe('diagnosable failures', () => {
        const decode: IncusError = {
            kind: 'decode',
            path: 'metadata[4].state.cpu.usage',
            detail: 'expected a finite number >= 0',
        };
        const api: IncusError = { kind: 'api', code: 500, message: 'storage pool is busy' };
        const timeout: IncusError = { kind: 'timeout' };

        const failWith = async (error: IncusError) => {
            const world = await started();
            world.client.instances.mockResolvedValueOnce(err(error));
            world.clock.advance(10_000);
            await flush();
            return world;
        };

        it('logs a decode failure with its path and detail', async () => {
            const { log } = await failWith(decode);
            expect(log.warn).toHaveBeenCalledTimes(1);
            expect(log.warn.mock.calls[0]?.[0]).toBe(
                'Incus decode error: metadata[4].state.cpu.usage: expected a finite number >= 0',
            );
        });

        it('logs an api failure with its code and daemon message', async () => {
            const { log } = await failWith(api);
            expect(log.warn).toHaveBeenCalledTimes(1);
            const message = log.warn.mock.calls[0]?.[0] ?? '';
            expect(message).toContain('Incus api error');
            expect(message).toContain('500');
            expect(message).toContain('storage pool is busy');
        });

        it('logs a timeout as a request that timed out', async () => {
            const { log } = await failWith(timeout);
            expect(log.warn).toHaveBeenCalledTimes(1);
            expect(log.warn.mock.calls[0]?.[0]).toMatch(/timed out/);
        });

        it.each([decode, api, timeout])(
            'logs a repeated $kind failure only once per episode',
            async error => {
                const { log, client, clock } = await failWith(error);
                client.instances.mockResolvedValue(err(error));
                for (const delay of [2000, 4000, 8000]) {
                    clock.advance(delay);
                    await flush();
                }
                expect(log.warn).toHaveBeenCalledTimes(1);
            },
        );

        it.each([decode, api, timeout])(
            'logs a $kind failure again after a success',
            async error => {
                const { log, client, clock } = await failWith(error);
                clock.advance(2000);
                await flush();
                client.instances.mockResolvedValueOnce(err(error));
                clock.advance(10_000);
                await flush();
                expect(log.warn).toHaveBeenCalledTimes(2);
            },
        );

        it('logs one warning when different diagnosable kinds follow each other', async () => {
            const { log, client, clock } = await failWith(decode);
            client.instances.mockResolvedValue(err(api));
            clock.advance(2000);
            await flush();
            expect(log.warn).toHaveBeenCalledTimes(1);
        });

        it.each([
            ['decode path', { ...decode, path: 'HOSTILE‮\n\u001b[31m' }],
            ['decode detail', { ...decode, detail: 'HOSTILE‮\n\u001b[31m' }],
            ['api message', { ...api, message: 'HOSTILE‮\n\u001b[31m' }],
        ] as const)('blanks control characters in a hostile %s', async (_name, error) => {
            const { log } = await failWith(error);
            const message = log.warn.mock.calls[0]?.[0] ?? '';
            expect(message).toContain('HOSTILE');
            expect(message).not.toMatch(/[\p{C}\u2028\u2029]/u);
        });

        it.each([
            ['decode path', { ...decode, path: 'x'.repeat(1e5) }],
            ['decode detail', { ...decode, detail: 'x'.repeat(1e5) }],
            ['api message', { ...api, message: 'x'.repeat(1e5) }],
        ] as const)('caps a very long %s', async (_name, error) => {
            const { log } = await failWith(error);
            const message = log.warn.mock.calls[0]?.[0] ?? '';
            expect(message).toContain('xxx');
            expect(message.length).toBeLessThanOrEqual(500 + 100);
        });
    });
});

/** Instances calls that stay open until the test answers them, with the overlap they caused. */
function countingInstances(world: World) {
    const open: Deferred<Awaited<ReturnType<IncusClient['instances']>>>[] = [];
    const stats = { active: 0, max: 0 };
    world.client.instances.mockImplementation(() => {
        const call = deferred<Awaited<ReturnType<IncusClient['instances']>>>();
        open.push(call);
        stats.active++;
        stats.max = Math.max(stats.max, stats.active);
        return call.promise.then(result => {
            stats.active--;
            return result;
        });
    });
    /** Answers calls one at a time until no new call appears. */
    const drain = async (): Promise<void> => {
        await flush();
        for (let guard = 0; guard < 20; guard++) {
            const next = open.shift();
            if (!next) return;
            next.resolve(ok([instance('web01', 'running')]));
            await flush();
        }
    };
    return { stats, drain };
}

describe('Monitor re-entrancy from onSnapshot', () => {
    // Rerun rule: requests made while a poll is in flight, however many, coalesce into exactly
    // one follow-up poll that starts after the running one settles. Never two at once.
    it.each(['connecting', 'refreshing', 'ready'] as const)(
        'runs one follow-up poll, never overlapping, when refresh() and setMenuOpen(true) are called during the %s emit',
        async during => {
            const holder: { monitor?: Monitor } = {};
            let armed = true;
            const world = setup({
                onSnapshot: s => {
                    if (s.kind !== during || !armed) return;
                    // 'refreshing' only exists after a first ready, so arm it later.
                    armed = false;
                    holder.monitor?.refresh();
                    holder.monitor?.setMenuOpen(true);
                },
            });
            holder.monitor = world.monitor;
            const { stats, drain } = countingInstances(world);
            if (during === 'refreshing') {
                armed = false;
                world.monitor.start();
                await drain();
                armed = true;
                world.clock.advance(10_000);
            } else {
                world.monitor.start();
            }
            await drain();
            const polls = during === 'refreshing' ? 3 : 2;
            expect(stats.max).toBe(1);
            expect(world.client.instances).toHaveBeenCalledTimes(polls);
            expect(instancesFlag(world.client.instances.mock.calls).at(-1)).toBe(true);
            expect(world.monitor.state.kind).toBe('ready');
        },
    );
});

describe('Monitor with unprintable thrown values', () => {
    const throwingToString = {
        toString: () => {
            throw new Error('toString break');
        },
    };
    const values: [string, () => unknown][] = [
        ['a null-prototype object', () => Object.create(null) as unknown],
        ['an object whose toString throws', () => throwingToString],
    ];
    const hows = ['reject', 'throw'] as const;
    const cases = values.flatMap(([name, make]) => hows.map(how => [name, how, make] as const));

    const arm = (
        mock: ReturnType<typeof setup>['client']['instances'],
        how: 'reject' | 'throw',
        v: unknown,
    ) => {
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the contract break under test
        if (how === 'reject') mock.mockImplementationOnce(() => Promise.reject(v));
        else
            mock.mockImplementationOnce(() => {
                throw v;
            });
    };

    it.each(cases)(
        'turns %s that is %s by instances into failed protocol with a retry and no unhandled rejection',
        async (_name, how, make) => {
            const { monitor, client, clock } = setup();
            arm(client.instances, how, make());
            const seen = await collectingUnhandled(async () => {
                monitor.start();
                await flush();
            });
            expect(seen).toStrictEqual([]);
            expect(monitor.state).toMatchObject({
                kind: 'failed',
                error: { kind: 'protocol' },
                retryInMs: 2000,
            });
            expect(clock.pending).toBe(1);
            clock.advance(2000);
            await flush();
            expect(monitor.state.kind).toBe('ready');
        },
    );

    it.each(cases)(
        'resolves perform with a protocol error when changeState gets %s that is %s, and does not wedge the queue',
        async (_name, how, make) => {
            const { monitor, client } = await started();
            const seen = await collectingUnhandled(async () => {
                if (how === 'reject')
                    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- the contract break under test
                    client.changeState.mockImplementationOnce(() => Promise.reject(make()));
                else
                    client.changeState.mockImplementationOnce(() => {
                        throw make();
                    });
                expect(await monitor.perform('stop', REF)).toMatchObject({
                    ok: false,
                    error: { kind: 'protocol' },
                });
                const done = vi.fn();
                void monitor.perform('stop', REF).then(done);
                await flush();
                expect(done).toHaveBeenCalledTimes(1);
            });
            expect(seen).toStrictEqual([]);
        },
    );

    it('logs one identical fixed placeholder for every unprintable value, free of control characters', async () => {
        const messages: string[] = [];
        for (const [, how, make] of cases) {
            const { monitor, client, log } = setup();
            arm(client.instances, how, make());
            monitor.start();
            await flush();
            expect(log.warn).toHaveBeenCalledTimes(1);
            messages.push(log.warn.mock.calls[0]?.[0] ?? '');
        }
        expect(new Set(messages).size).toBe(1);
        expect(messages[0]).not.toBe('');
        expect(messages[0]).not.toMatch(/\p{C}/u);
    });
});

describe('Monitor thrown text exposure', () => {
    const hostile = 'LEAKMARK\u202e\n'.repeat(1e5);

    it('keeps the thrown text out of the failed detail', async () => {
        const { monitor, client } = setup();
        client.instances.mockRejectedValueOnce(new Error(hostile));
        monitor.start();
        await flush();
        const state = monitor.state;
        if (state.kind !== 'failed' || state.error.kind !== 'protocol')
            throw new Error('expected failed protocol');
        expect(state.error.detail).not.toContain('LEAKMARK');
        expect(state.error.detail).not.toMatch(/[\p{C}\u2028\u2029]/u);
        expect(state.error.detail.length).toBeLessThanOrEqual(300);
    });

    it('gives the same failed detail whatever was thrown', async () => {
        const details: string[] = [];
        for (const thrown of [new Error(hostile), 'plain', 42]) {
            const { monitor, client } = setup();
            client.instances.mockRejectedValueOnce(thrown);
            monitor.start();
            await flush();
            const state = monitor.state;
            if (state.kind !== 'failed' || state.error.kind !== 'protocol')
                throw new Error('expected failed protocol');
            details.push(state.error.detail);
        }
        expect(new Set(details).size).toBe(1);
    });

    it('logs the thrown text sanitised and capped', async () => {
        const reference = setup();
        reference.client.instances.mockRejectedValueOnce(new Error('a'));
        reference.monitor.start();
        await flush();
        const prefixLength = (reference.log.warn.mock.calls[0]?.[0] ?? '').length - 1;

        const { monitor, client, log } = setup();
        client.instances.mockRejectedValueOnce(new Error(hostile));
        monitor.start();
        await flush();
        const message = log.warn.mock.calls[0]?.[0] ?? '';
        expect(message).toContain('LEAKMARK');
        expect(message).not.toMatch(/\p{C}/u);
        expect(message.length).toBeLessThanOrEqual(500 + prefixLength);
    });

    it('does not put the thrown text of a failed changeState into the perform error', async () => {
        const { monitor, client } = await started();
        client.changeState.mockRejectedValueOnce(new Error(hostile));
        const result = await monitor.perform('stop', REF);
        expect(JSON.stringify(result)).not.toContain('LEAKMARK');
    });
});

describe('Monitor dispose and menu edge branches', () => {
    it('schedules and polls nothing when dispose is called inside the ready emit', async () => {
        const holder: { monitor?: Monitor } = {};
        const world = setup({
            onSnapshot: s => {
                if (s.kind === 'ready') holder.monitor?.dispose();
            },
        });
        holder.monitor = world.monitor;
        world.monitor.start();
        await flush();
        expect(world.clock.pending).toBe(0);
        world.clock.advance(120_000);
        await flush();
        expect(world.client.instances).toHaveBeenCalledTimes(1);
    });

    it('lets perform resolve ok and polls no more when dispose lands while it waits for the in-flight refresh', async () => {
        const { monitor, client, clock, snapshots } = await started();
        const pending = deferred<Awaited<ReturnType<IncusClient['instances']>>>();
        client.instances.mockReturnValueOnce(pending.promise);
        clock.advance(10_000);
        await flush();
        const result = monitor.perform('stop', REF);
        await flush();
        expect(client.wait).toHaveBeenCalledTimes(1);
        const before = snapshots.length;
        monitor.dispose();
        pending.resolve(ok([instance('web01', 'stopped')]));
        expect(await result).toStrictEqual(ok(true));
        await flush();
        expect(client.instances).toHaveBeenCalledTimes(2);
        expect(snapshots.length).toBe(before);
        expect(clock.pending).toBe(0);
    });

    it('keeps the back-off retry delay when the menu closes while failed', async () => {
        const { monitor, clock, probe } = setup({
            access: { [SYSTEM_SOCKET]: 'missing', [USER_SOCKET]: 'missing' },
        });
        monitor.setMenuOpen(true);
        monitor.start();
        await flush();
        expect(monitor.state).toMatchObject({ kind: 'failed', retryInMs: 2000 });
        monitor.setMenuOpen(false);
        const before = probe.calls.length;
        clock.advance(1999);
        await flush();
        expect(probe.calls.length).toBe(before);
        clock.advance(1);
        await flush();
        expect(probe.calls.length).toBeGreaterThan(before);
    });

    it('resolves perform with cancelled when changeState rejects after dispose', async () => {
        const { monitor, client } = await started();
        let fail!: (reason: Error) => void;
        client.changeState.mockReturnValueOnce(
            new Promise<never>((_, reject) => {
                fail = reject;
            }),
        );
        const result = monitor.perform('stop', REF);
        await flush();
        monitor.dispose();
        fail(new Error('late contract break'));
        expect(await result).toStrictEqual(err({ kind: 'cancelled' }));
    });
});

describe('Monitor refresh during a failing poll', () => {
    it('waits for the back-off instead of retrying at once', async () => {
        const world = setup();
        const pending = deferred<Awaited<ReturnType<IncusClient['instances']>>>();
        world.client.instances.mockReturnValueOnce(pending.promise);
        world.monitor.start();
        await flush();
        world.monitor.refresh();
        pending.resolve(err({ kind: 'unreachable' }));
        await flush();
        expect(world.client.instances).toHaveBeenCalledTimes(1);
        expect(world.clock.pending).toBe(1);
        expect(world.monitor.state).toStrictEqual({
            kind: 'failed',
            error: { kind: 'unreachable' },
            retryInMs: 2000,
        });
        world.clock.advance(1999);
        await flush();
        expect(world.client.instances).toHaveBeenCalledTimes(1);
        world.clock.advance(1);
        await flush();
        expect(world.client.instances).toHaveBeenCalledTimes(2);
    });
});

describe('Monitor onSnapshot throwing on the ready emit', () => {
    it('stays ready, never emits failed, and warns with the thrown text', async () => {
        const world = setup({
            onSnapshot: s => {
                if (s.kind === 'ready') throw new Error('render break');
            },
        });
        world.monitor.start();
        await flush();
        expect(world.monitor.state.kind).toBe('ready');
        expect(world.kinds()).not.toContain('failed');
        expect(world.log.warn).toHaveBeenCalledTimes(1);
        expect(world.log.warn.mock.calls[0]?.[0]).toContain(
            'onSnapshot threw: Error: render break',
        );
    });
});

describe('knownInstances', () => {
    const list: readonly Instance[] = [
        {
            project: 'default',
            name: 'a',
            type: 'container',
            status: 'running',
            state: null,
            forwards: [],
        },
    ];

    it('returns the instances of a ready snapshot', () => {
        expect(knownInstances({ kind: 'ready', instances: list, atMs: 0 })).toBe(list);
    });

    it('returns the previous instances of a refreshing snapshot', () => {
        expect(knownInstances({ kind: 'refreshing', previous: list })).toBe(list);
    });

    it.each<Snapshot>([
        { kind: 'idle' },
        { kind: 'connecting' },
        { kind: 'failed', error: { kind: 'unreachable' }, retryInMs: 2000 },
    ])('returns null, not an empty list, when a $kind snapshot has no data', snapshot => {
        expect(knownInstances(snapshot)).toBeNull();
    });
});
