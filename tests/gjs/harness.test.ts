// SPDX-License-Identifier: GPL-2.0-or-later
import GLib from 'gi://GLib';

import { AssertionError, assert, test } from './harness.js';

test('harness: async tests run inside the main loop', async () => {
    const fired = await new Promise<boolean>(resolve => {
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            resolve(true);
            return GLib.SOURCE_REMOVE;
        });
    });
    assert.equal(fired, true);
});

test('harness: deepEqual reports structural mismatches', async () => {
    await assert.rejects(
        Promise.resolve().then(() => {
            assert.deepEqual({ a: 1 }, { a: 2 });
        }),
        error => error instanceof AssertionError,
    );
});
