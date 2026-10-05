// SPDX-License-Identifier: GPL-2.0-or-later

// GLib takes a guint interval; larger values wrap around and would fire at once.
const MAX_DELAY_MS = 2 ** 31 - 1;

/** Coerces a delay to what GLib timeouts accept: NaN becomes 0, the rest is rounded and clamped. */
export function clampDelayMs(ms: number): number {
    return Number.isNaN(ms) ? 0 : Math.min(Math.max(0, Math.round(ms)), MAX_DELAY_MS);
}
