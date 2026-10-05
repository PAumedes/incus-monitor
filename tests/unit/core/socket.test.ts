// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';

import type { IncusError } from '../../../src/core/errors.js';
import { CancelSource } from '../../../src/core/cancel.js';
import { err, ok } from '../../../src/core/result.js';
import type { Result } from '../../../src/core/result.js';
import type { SocketAccess } from '../../../src/core/ports.js';
import { SYSTEM_SOCKET, USER_SOCKET, discoverSocket } from '../../../src/core/socket.js';
import { FakeSocketProbe } from '../fakes/socket-probe.js';

const CUSTOM = '/run/custom.sock';

describe('socket paths', () => {
    it('uses the documented system and incus-user sockets', () => {
        expect(SYSTEM_SOCKET).toBe('/var/lib/incus/unix.socket');
        expect(USER_SOCKET).toBe('/var/lib/incus/unix.socket.user');
    });
});

describe('discoverSocket without an override', () => {
    const table: [SocketAccess, SocketAccess, string][] = [
        ['missing', 'missing', 'not-installed'],
        ['missing', 'denied', 'permission-denied'],
        ['denied', 'missing', 'permission-denied'],
        ['denied', 'denied', 'permission-denied'],
    ];

    it.each(table)('system %s and user %s fail with %s', async (system, user, kind) => {
        const probe = new FakeSocketProbe({ [SYSTEM_SOCKET]: system, [USER_SOCKET]: user });
        expect(await discoverSocket(probe, undefined, new CancelSource().signal)).toStrictEqual(
            err({ kind }),
        );
    });

    it.each<[SocketAccess, SocketAccess, string]>([
        ['usable', 'missing', SYSTEM_SOCKET],
        ['usable', 'denied', SYSTEM_SOCKET],
        ['usable', 'usable', SYSTEM_SOCKET],
        ['missing', 'usable', USER_SOCKET],
        ['denied', 'usable', USER_SOCKET],
    ])('system %s and user %s selects %s', async (system, user, expected) => {
        const probe = new FakeSocketProbe({ [SYSTEM_SOCKET]: system, [USER_SOCKET]: user });
        expect(await discoverSocket(probe, undefined, new CancelSource().signal)).toStrictEqual(
            ok(expected),
        );
    });

    it('does not probe later candidates once one is usable', async () => {
        const probe = new FakeSocketProbe({ [SYSTEM_SOCKET]: 'usable', [USER_SOCKET]: 'usable' });
        await discoverSocket(probe, undefined, new CancelSource().signal);
        expect(probe.calls).toStrictEqual([SYSTEM_SOCKET]);
    });

    it('probes the system socket before the user socket', async () => {
        const probe = new FakeSocketProbe({ [SYSTEM_SOCKET]: 'missing', [USER_SOCKET]: 'missing' });
        await discoverSocket(probe, undefined, new CancelSource().signal);
        expect(probe.calls).toStrictEqual([SYSTEM_SOCKET, USER_SOCKET]);
    });

    it('treats an empty override as unset', async () => {
        const probe = new FakeSocketProbe({ [SYSTEM_SOCKET]: 'usable' });
        expect(await discoverSocket(probe, '', new CancelSource().signal)).toStrictEqual(
            ok(SYSTEM_SOCKET),
        );
        expect(probe.calls).toStrictEqual([SYSTEM_SOCKET]);
    });

    it('keeps permission-denied when a later candidate is missing', async () => {
        const probe = new FakeSocketProbe({ [SYSTEM_SOCKET]: 'denied', [USER_SOCKET]: 'missing' });
        expect(await discoverSocket(probe, undefined, new CancelSource().signal)).toStrictEqual(
            err({ kind: 'permission-denied' }),
        );
    });
});

describe('discoverSocket with an override', () => {
    it.each<[SocketAccess, Result<string, IncusError>]>([
        ['usable', ok(CUSTOM)],
        ['denied', err({ kind: 'permission-denied' })],
        ['missing', err({ kind: 'not-installed' })],
    ])('a %s override yields the matching result', async (access, expected) => {
        const probe = new FakeSocketProbe({ [CUSTOM]: access });
        expect(await discoverSocket(probe, CUSTOM, new CancelSource().signal)).toStrictEqual(
            expected,
        );
    });

    it('is the only candidate probed', async () => {
        const probe = new FakeSocketProbe({ [CUSTOM]: 'missing' });
        await discoverSocket(probe, CUSTOM, new CancelSource().signal);
        expect(probe.calls).toStrictEqual([CUSTOM]);
    });
});

describe('discoverSocket cancellation', () => {
    const both = { [SYSTEM_SOCKET]: 'usable', [USER_SOCKET]: 'usable' } as const;

    it('returns cancelled without probing when already cancelled', async () => {
        const source = new CancelSource();
        source.cancel();
        const probe = new FakeSocketProbe(both);
        expect(await discoverSocket(probe, undefined, source.signal)).toStrictEqual(
            err({ kind: 'cancelled' }),
        );
        expect(probe.calls).toStrictEqual([]);
    });

    it('returns cancelled and skips later candidates when cancelled during a probe', async () => {
        const source = new CancelSource();
        const probe = new FakeSocketProbe(
            { [SYSTEM_SOCKET]: 'denied', [USER_SOCKET]: 'usable' },
            () => {
                source.cancel();
            },
        );
        expect(await discoverSocket(probe, undefined, source.signal)).toStrictEqual(
            err({ kind: 'cancelled' }),
        );
        expect(probe.calls).toStrictEqual([SYSTEM_SOCKET]);
    });

    it('returns cancelled even if the probe resolved usable', async () => {
        const source = new CancelSource();
        const probe = new FakeSocketProbe(both, () => {
            source.cancel();
        });
        expect(await discoverSocket(probe, undefined, source.signal)).toStrictEqual(
            err({ kind: 'cancelled' }),
        );
    });

    it('hands the caller signal to every probe', async () => {
        const { signal } = new CancelSource();
        const probe = new FakeSocketProbe({ [SYSTEM_SOCKET]: 'missing', [USER_SOCKET]: 'missing' });
        await discoverSocket(probe, undefined, signal);
        expect(probe.signals).toHaveLength(2);
        for (const received of probe.signals) expect(received).toBe(signal);
    });

    it.each<SocketAccess>(['denied', 'missing'])(
        'returns cancelled when cancelled during the only probe, answered %s',
        async access => {
            const source = new CancelSource();
            const probe = new FakeSocketProbe({ [CUSTOM]: access }, () => {
                source.cancel();
            });
            expect(await discoverSocket(probe, CUSTOM, source.signal)).toStrictEqual(
                err({ kind: 'cancelled' }),
            );
        },
    );

    it('returns cancelled when cancelled during the user socket probe', async () => {
        const source = new CancelSource();
        const probe = new FakeSocketProbe(
            { [SYSTEM_SOCKET]: 'missing', [USER_SOCKET]: 'missing' },
            path => {
                if (path === USER_SOCKET) source.cancel();
            },
        );
        expect(await discoverSocket(probe, undefined, source.signal)).toStrictEqual(
            err({ kind: 'cancelled' }),
        );
    });
});
