// SPDX-License-Identifier: GPL-2.0-or-later
import type { MonitorDeps } from './monitor.js';

/**
 * The monitor's view of the settings. The refresh interval is a live getter over `source`, so a
 * changed preference applies on the next schedule. The socket override has no GSettings key: it
 * comes from the environment, so changing it needs a new Monitor.
 */
export function monitorSettings(
    source: { readonly refreshIntervalSeconds: number },
    getenv: (name: string) => string | null,
): MonitorDeps['settings'] {
    return {
        get refreshIntervalSeconds() {
            return source.refreshIntervalSeconds;
        },
        socketOverride: getenv('INCUS_SOCKET') ?? undefined,
    };
}
