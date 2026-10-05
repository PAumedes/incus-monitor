// SPDX-License-Identifier: GPL-2.0-or-later
import { isCancelled } from './cancel.js';
import type { CancelSignal } from './cancel.js';
import type { IncusError } from './errors.js';
import type { SocketProbe } from './ports.js';
import { err, ok } from './result.js';
import type { Result } from './result.js';

export const SYSTEM_SOCKET = '/var/lib/incus/unix.socket';
export const USER_SOCKET = '/var/lib/incus/unix.socket.user';

/** Picks the first usable socket. A non-empty override is the only candidate. */
export async function discoverSocket(
    probe: SocketProbe,
    override: string | undefined,
    signal: CancelSignal,
): Promise<Result<string, IncusError>> {
    const candidates = override ? [override] : [SYSTEM_SOCKET, USER_SOCKET];
    let denied = false;
    for (const path of candidates) {
        if (isCancelled(signal)) return err({ kind: 'cancelled' });
        const access = await probe.access(path, signal);
        if (isCancelled(signal)) return err({ kind: 'cancelled' });
        if (access === 'usable') return ok(path);
        denied ||= access === 'denied';
    }
    return err({ kind: denied ? 'permission-denied' : 'not-installed' });
}
