// SPDX-License-Identifier: GPL-2.0-or-later
// Shared helpers for adapter tests: temp directories, sleeping on the main loop, counted signals.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { CancelSource, type CancelSignal } from '../../src/core/cancel.js';

export function sleep(ms: number): Promise<void> {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

/** Runs a program to completion (tests only, never the shell process). */
export function run(argv: readonly string[]): void {
    const [ok, , , status] = GLib.spawn_sync(
        null,
        [...argv],
        null,
        GLib.SpawnFlags.SEARCH_PATH,
        null,
    );
    if (!ok || status !== 0) throw new Error(`command failed: ${argv.join(' ')}`);
}

/** Creates a private temp directory for one test and always removes it, whatever its modes. */
export async function withTempDir<T>(body: (dir: string) => Promise<T>): Promise<T> {
    const dir = GLib.dir_make_tmp('incus-test-XXXXXX');
    try {
        return await body(dir);
    } finally {
        run(['chmod', '-R', 'u+rwx', dir]);
        run(['rm', '-rf', dir]);
    }
}

export function writeFile(path: string, text: string, mode?: number): void {
    const file = Gio.File.new_for_path(path);
    file.replace_contents(
        new TextEncoder().encode(text),
        null,
        false,
        Gio.FileCreateFlags.NONE,
        null,
    );
    if (mode !== undefined) GLib.chmod(path, mode);
}

export function readFile(path: string): string | undefined {
    const file = Gio.File.new_for_path(path);
    if (!file.query_exists(null)) return undefined;
    const [, bytes] = file.load_contents(null);
    return new TextDecoder().decode(bytes);
}

/** True when permission bits are bypassed (root), so "permission denied" cases cannot be built. */
export const RUNNING_AS_ROOT = /^Uid:\s+\d+\s+0\s/m.test(readFile('/proc/self/status') ?? '');

/** Waits until `check` returns a value, polling on the main loop. Fails after `timeoutMs`. */
export async function eventually<T>(check: () => T | undefined, timeoutMs = 5000): Promise<T> {
    const deadline = GLib.get_monotonic_time() + timeoutMs * 1000;
    for (;;) {
        const value = check();
        if (value !== undefined) return value;
        if (GLib.get_monotonic_time() > deadline) throw new Error('condition not reached in time');
        await sleep(10);
    }
}

/** A real CancelSignal that records how many onCancel registrations are still active. */
export class CountingSignal implements CancelSignal {
    readonly #source = new CancelSource();
    registrations = 0;
    active = 0;

    get cancelled(): boolean {
        return this.#source.signal.cancelled;
    }

    onCancel(callback: () => void): () => void {
        this.registrations++;
        this.active++;
        const off = this.#source.signal.onCancel(callback);
        let done = false;
        return () => {
            if (!done) {
                done = true;
                this.active--;
            }
            off();
        };
    }

    cancel(): void {
        this.#source.cancel();
    }
}

// console is frozen in GJS, so console.warn cannot be replaced. Its output goes through GLib's
// structured log writer instead. A process can install a writer only once, so it is installed on
// the first collectingWarnings call; outside a collection it prints like the default writer.
let warnings: string[] | undefined;
let writerInstalled = false;

// GJS passes the fields as an object of GLib.Bytes keyed by field name; the typings say array.
type LogFields = Record<string, unknown>;

function fieldText(fields: LogFields, name: string): string {
    const value = fields[name];
    if (typeof value === 'string') return value;
    if (value instanceof Uint8Array) return new TextDecoder().decode(value);
    if (value instanceof GLib.Bytes) return new TextDecoder().decode(value.toArray());
    return '';
}

function installWriter(): void {
    if (writerInstalled) return;
    writerInstalled = true;
    GLib.log_set_writer_func((level, rawFields) => {
        const fields = rawFields as unknown as LogFields;
        const domain = fieldText(fields, 'GLIB_DOMAIN');
        const message = fieldText(fields, 'MESSAGE');
        const loud =
            (level & (GLib.LogLevelFlags.LEVEL_WARNING | GLib.LogLevelFlags.LEVEL_CRITICAL)) !== 0;
        if (warnings && loud) {
            warnings.push(domain === 'Gjs-Console' ? message : `${domain}: ${message}`);
            return GLib.LogWriterOutput.HANDLED;
        }
        printerr(`${domain}: ${message}`);
        return GLib.LogWriterOutput.HANDLED;
    });
}

/**
 * Runs `body` and returns every console.warn message it produced, plus any GLib warning or
 * critical, which carries its domain as a prefix so a test can assert there were none.
 */
export async function collectingWarnings(body: () => Promise<void>): Promise<string[]> {
    installWriter();
    const collected: string[] = [];
    warnings = collected;
    try {
        await body();
    } finally {
        warnings = undefined;
    }
    return collected;
}

export interface SourceTracker {
    /** Delays, in ms, of every timeout source created, in order. */
    readonly intervals: number[];
    /** Source IDs passed to GLib.Source.remove, in order. */
    readonly removed: number[];
    /** Created sources that have neither fired and finished nor been removed. */
    live(): number;
}

interface Mutable {
    timeout_add: typeof GLib.timeout_add;
    Source: { remove: typeof GLib.Source.remove };
}

/** Runs `body` with GLib.timeout_add and GLib.Source.remove observed, then restores them. */
export async function trackingSources<T>(
    body: (tracker: SourceTracker) => T | Promise<T>,
): Promise<T> {
    const glib = GLib as unknown as Mutable;
    const { timeout_add: add } = glib;
    const remove = glib.Source.remove;
    const pending = new Set<number>();
    const tracker: SourceTracker = {
        intervals: [],
        removed: [],
        live: () => pending.size,
    };
    glib.timeout_add = (priority, interval, callback) => {
        tracker.intervals.push(interval);
        const id = add(priority, interval, () => {
            const keep = callback(null);
            if (!keep) pending.delete(id);
            return keep;
        });
        pending.add(id);
        return id;
    };
    glib.Source.remove = id => {
        tracker.removed.push(id);
        pending.delete(id);
        return remove.call(GLib.Source, id);
    };
    try {
        return await body(tracker);
    } finally {
        glib.timeout_add = add;
        glib.Source.remove = remove;
    }
}
