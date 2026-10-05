// SPDX-License-Identifier: GPL-2.0-or-later
import type { CancelSignal } from './cancel.js';

/** What the current user may do with a socket path. */
export type SocketAccess = 'missing' | 'denied' | 'usable';

/**
 * Classifies a socket path without connecting to it. Total: the promise never rejects, because
 * the adapter maps every failure to a value.
 */
export interface SocketProbe {
    access(path: string, signal: CancelSignal): Promise<SocketAccess>;
}
