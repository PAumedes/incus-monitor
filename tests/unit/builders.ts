// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from 'node:fs';

/** Loose JSON used to build wire-format variations; decoders receive it as `unknown`. */
export type Json = Record<string, unknown>;

export function readFixture(series: string, name: string): { readonly metadata: unknown } {
    const url = new URL(`../fixtures/incus/${series}/${name}.json`, import.meta.url);
    // Test-only cast: fixtures are trusted, recorded files.
    return (JSON.parse(readFileSync(url, 'utf8')) as { body: { metadata: unknown } }).body;
}

function clone<T>(value: T): T {
    // `undefined` values vanish here, which is how a builder override deletes a key.
    return JSON.parse(JSON.stringify(value)) as T;
}

/** The recorded recursion=2 instance (web01), with top-level fields replaced by `overrides`. */
export function instanceJson(overrides: Json = {}): Json {
    const list = readFixture('6.0', 'instances-recursion2').metadata as Json[];
    return clone({ ...list[0], ...overrides });
}

/** The recorded instance with `state` fields replaced. `undefined` removes a field. */
export function withState(overrides: Json): Json {
    const base = instanceJson();
    return clone({ ...base, state: { ...(base['state'] as Json), ...overrides } });
}

/** A network interface as Incus reports it; `undefined` arguments fall back to a plain NIC. */
export function nic(
    addresses: readonly Json[],
    type = 'broadcast',
    counters: Json = { bytes_received: 0, bytes_sent: 0 },
): Json {
    return { addresses, counters, type, state: 'up' };
}

export function address(family: string, value: string, scope = 'global'): Json {
    return { family, address: value, netmask: '64', scope };
}

export function withNetwork(network: Json): Json {
    return withState({ network });
}
