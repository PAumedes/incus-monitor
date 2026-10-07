// SPDX-License-Identifier: GPL-2.0-or-later
import { CancelSource, isCancelled, type CancelSignal } from './cancel.js';
import type { IncusError } from './errors.js';
import { checkCompat } from './incus/compat.js';
import { isActionAvailable, type InstanceAction } from './incus/actions.js';
import type { IncusClient } from './incus/client.js';
import { instanceKey, type Instance, type InstanceRef } from './incus/models.js';
import { userMessage } from './incus/validate.js';
import type { Clock, SocketProbe } from './ports.js';
import { err, ok, type Result } from './result.js';
import { discoverSocket } from './socket.js';

export type MonitorClient = Pick<IncusClient, 'server' | 'instances' | 'changeState' | 'wait'>;

export type Snapshot =
    | { readonly kind: 'idle' }
    | { readonly kind: 'connecting' }
    // atMs is the Clock's monotonic reading, not wall time.
    | { readonly kind: 'ready'; readonly instances: readonly Instance[]; readonly atMs: number }
    | { readonly kind: 'refreshing'; readonly previous: readonly Instance[] }
    | { readonly kind: 'failed'; readonly error: IncusError; readonly retryInMs: number };

/**
 * The instances a snapshot still knows about: the fresh list, or the last one while a refresh
 * runs. Null when there is no data (not started, connecting, failed), which is not the same as
 * an empty host.
 */
export function knownInstances(snapshot: Snapshot): readonly Instance[] | null {
    switch (snapshot.kind) {
        case 'ready':
            return snapshot.instances;
        case 'refreshing':
            return snapshot.previous;
        case 'idle':
        case 'connecting':
        case 'failed':
            return null;
    }
}

export interface MonitorDeps {
    connect(socketPath: string): MonitorClient;
    readonly probe: SocketProbe;
    readonly clock: Clock;
    /**
     * Read on every schedule and connection attempt, so the composition root passes a live view
     * of GSettings. A changed socket override only takes effect on a new Monitor (T12).
     */
    readonly settings: {
        readonly refreshIntervalSeconds: number;
        readonly socketOverride: string | undefined;
    };
    readonly log: { warn(message: string): void };
    onSnapshot(snapshot: Snapshot): void;
}

// Also the floor of the closed-menu cadence.
const OPEN_INTERVAL_MS = 2000;
const BACKOFF_INITIAL_MS = 2000;
const BACKOFF_MAX_MS = 60_000;
// An unsupported server will not change within a session, so it is rechecked rarely.
const UNSUPPORTED_RETRY_MS = 60_000;

// Failures that mean the socket itself may have changed, so discovery runs again.
const CONNECTION_FAILURES: readonly IncusError['kind'][] = [
    'not-installed',
    'permission-denied',
    'unreachable',
    'timeout',
];

type Outcome<T> = Result<T, IncusError>;

const PROTOCOL_ERROR = 'Incus protocol error';
const BROKEN_CONTRACT = 'a port broke its contract';
const UNPRINTABLE = 'unprintable value';

/** Total: a thrown value may be a null-prototype object or have a throwing toString. */
const describeThrown = (thrown: unknown): string => {
    try {
        return String(thrown);
    } catch {
        return UNPRINTABLE;
    }
};

const cancelled = (): Outcome<never> => err({ kind: 'cancelled' });

export class Monitor {
    readonly #source = new CancelSource();
    readonly #queues = new Map<string, Promise<void>>();
    #state: Snapshot = { kind: 'idle' };
    #started = false;
    #disposed = false;
    #menuOpen = false;
    #client: MonitorClient | undefined;
    #compatible = false;
    #backoffMs = BACKOFF_INITIAL_MS;
    #warned = false;
    // A request asked for while one was in flight; it runs right after that one settles.
    #rerunRequested = false;
    #inFlight: Promise<void> | undefined;
    #cancelTimer: (() => void) | undefined;

    constructor(private readonly deps: MonitorDeps) {}

    get state(): Snapshot {
        return this.#state;
    }

    start(): void {
        if (this.#disposed || this.#started) return;
        this.#started = true;
        void this.#poll();
    }

    setMenuOpen(open: boolean): void {
        if (this.#disposed || open === this.#menuOpen) return;
        this.#menuOpen = open;
        if (!this.#started) return;
        if (open) {
            void this.#poll();
        } else if (this.#state.kind === 'ready') {
            this.#schedule(this.#cadenceMs());
        }
    }

    refresh(): void {
        if (this.#disposed || !this.#started) return;
        void this.#poll();
    }

    /** Resolves after the refresh that follows the action, so callers see the new state. */
    perform(action: InstanceAction, ref: InstanceRef): Promise<Outcome<true>> {
        const key = instanceKey(ref);
        const previous = this.#queues.get(key) ?? Promise.resolve();
        const run = previous.then(() => this.#guardedPerform(action, ref));
        const tail = run.then(() => undefined);
        this.#queues.set(key, tail);
        void tail.then(() => {
            if (this.#queues.get(key) === tail) this.#queues.delete(key);
        });
        return run;
    }

    dispose(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        this.#clearTimer();
        this.#source.cancel();
    }

    /** Ports are total, so a rejection is a broken contract; it must not wedge the queue. */
    async #guardedPerform(action: InstanceAction, ref: InstanceRef): Promise<Outcome<true>> {
        if (this.#disposed) return cancelled();
        try {
            return await this.#perform(action, ref);
        } catch (error) {
            // The log keeps the thrown text; the result deliberately omits it.
            this.#warnOnce(`${PROTOCOL_ERROR}: ${BROKEN_CONTRACT}: ${describeThrown(error)}`);
            return isCancelled(this.#source.signal)
                ? cancelled()
                : err({ kind: 'protocol', detail: BROKEN_CONTRACT });
        }
    }

    async #perform(action: InstanceAction, ref: InstanceRef): Promise<Outcome<true>> {
        const client = this.#client;
        const target = (knownInstances(this.#state) ?? []).find(
            i => i.project === ref.project && i.name === ref.name,
        );
        if (target === undefined || !client || !isActionAvailable(action, target.status)) {
            const reason = `${action} is not available for this instance`;
            return err({ kind: 'unsupported', reason });
        }
        const signal = this.#source.signal;
        const started = await client.changeState(ref, action, signal);
        if (!started.ok) return started;
        const finished = await client.wait(started.value, signal);
        // The action keeps running on the server when only our wait was cut off.
        const failure = !finished.ok && finished.error.kind !== 'cancelled' ? finished : undefined;
        if (!isCancelled(signal)) await this.#refreshNow();
        return failure ?? ok(true);
    }

    async #refreshNow(): Promise<void> {
        while (this.#inFlight) await this.#inFlight;
        await this.#poll();
    }

    #cadenceMs(): number {
        if (this.#menuOpen) return OPEN_INTERVAL_MS;
        const ms = this.deps.settings.refreshIntervalSeconds * 1000;
        // The comparison is false for NaN, so a corrupt setting falls back to the floor.
        return ms > OPEN_INTERVAL_MS ? ms : OPEN_INTERVAL_MS;
    }

    #clearTimer(): void {
        const cancel = this.#cancelTimer;
        this.#cancelTimer = undefined;
        cancel?.();
    }

    #schedule(ms: number): void {
        this.#clearTimer();
        if (this.#disposed) return;
        this.#cancelTimer = this.deps.clock.setTimeout(ms, () => {
            this.#cancelTimer = undefined;
            void this.#poll();
        });
    }

    /** A throwing consumer must not stop the loop, so it is logged and dropped. */
    #isolate(what: string, call: () => void): void {
        try {
            call();
        } catch (error) {
            this.#warnOnce(`${PROTOCOL_ERROR}: ${what} threw: ${describeThrown(error)}`);
        }
    }

    /** One warning per failure episode; the text reaches the log only after the one sanitiser. */
    #warnOnce(text: string): void {
        if (this.#disposed || this.#warned) return;
        this.#warned = true;
        this.deps.log.warn(userMessage(text));
    }

    /** Only failures a bug report can act on are logged; the rest are explained in the menu. */
    #warnDiagnosable(error: IncusError): void {
        switch (error.kind) {
            case 'protocol':
                this.#warnOnce(`${PROTOCOL_ERROR}: ${error.detail}`);
                break;
            case 'decode':
                this.#warnOnce(`Incus decode error: ${error.path}: ${error.detail}`);
                break;
            case 'api':
                this.#warnOnce(`Incus api error ${String(error.code)}: ${error.message}`);
                break;
            case 'timeout':
                this.#warnOnce('Incus request timed out');
                break;
            case 'not-installed':
            case 'permission-denied':
            case 'unsupported':
            case 'unreachable':
            case 'cancelled':
                break;
        }
    }

    #emit(snapshot: Snapshot): void {
        this.#state = snapshot;
        this.#isolate('onSnapshot', () => {
            this.deps.onSnapshot(snapshot);
        });
    }

    /** One request in flight: a call during a poll only marks a rerun and joins it. */
    #poll(): Promise<void> {
        if (this.#disposed) return Promise.resolve();
        if (this.#inFlight) {
            this.#rerunRequested = true;
            return this.#inFlight;
        }
        // Marked before the cycle's synchronous head runs, so a call from onSnapshot joins it.
        let settle = (): void => undefined;
        const inFlight = new Promise<void>(resolve => {
            settle = resolve;
        });
        this.#inFlight = inFlight;
        void this.#cycle().then(settle);
        return inFlight;
    }

    /** The single guard of the polling loop: nothing a port or callback does may end it. */
    async #cycle(): Promise<void> {
        let succeeded = false;
        try {
            succeeded = await this.#attempt(this.#source.signal);
        } catch (error) {
            this.#warnOnce(`${PROTOCOL_ERROR}: ${BROKEN_CONTRACT}: ${describeThrown(error)}`);
            this.#fail({ kind: 'protocol', detail: BROKEN_CONTRACT });
        } finally {
            const rerun = succeeded && this.#rerunRequested;
            this.#inFlight = undefined;
            this.#rerunRequested = false;
            if (rerun) void this.#poll();
        }
    }

    async #attempt(signal: CancelSignal): Promise<boolean> {
        this.#clearTimer();
        const state = this.#state;
        if (state.kind === 'idle') this.#emit({ kind: 'connecting' });
        else if (state.kind === 'ready')
            this.#emit({ kind: 'refreshing', previous: state.instances });
        const outcome = await this.#fetch(signal);
        if (isCancelled(signal)) return false;
        if (!outcome.ok) {
            // Our own signal is live, so a cancelled result is an adapter's own cut-off.
            this.#fail(
                outcome.error.kind === 'cancelled' ? { kind: 'unreachable' } : outcome.error,
            );
            return false;
        }
        this.#backoffMs = BACKOFF_INITIAL_MS;
        this.#warned = false;
        this.#emit({ kind: 'ready', instances: outcome.value, atMs: this.deps.clock.now() });
        this.#schedule(this.#cadenceMs());
        return true;
    }

    async #fetch(signal: CancelSignal): Promise<Outcome<readonly Instance[]>> {
        const client = await this.#connect(signal);
        if (!client.ok) return client;
        if (!this.#compatible) {
            const server = await client.value.server(signal);
            if (isCancelled(signal)) return cancelled();
            if (!server.ok) return server;
            const compat = checkCompat(server.value);
            if (!compat.ok) return compat;
            this.#compatible = true;
        }
        return client.value.instances(this.#menuOpen, signal);
    }

    async #connect(signal: CancelSignal): Promise<Outcome<MonitorClient>> {
        if (this.#client) return ok(this.#client);
        const { probe, settings } = this.deps;
        const socket = await discoverSocket(probe, settings.socketOverride, signal);
        if (!socket.ok) return socket;
        this.#client = this.deps.connect(socket.value);
        return ok(this.#client);
    }

    #fail(error: IncusError): void {
        if (this.#disposed) return;
        if (CONNECTION_FAILURES.includes(error.kind)) {
            this.#client = undefined;
            this.#compatible = false;
        }
        this.#warnDiagnosable(error);
        let retryInMs = UNSUPPORTED_RETRY_MS;
        if (error.kind !== 'unsupported') {
            retryInMs = this.#backoffMs;
            this.#backoffMs = Math.min(this.#backoffMs * 2, BACKOFF_MAX_MS);
        }
        this.#emit({ kind: 'failed', error, retryInMs });
        this.#schedule(retryInMs);
    }
}
