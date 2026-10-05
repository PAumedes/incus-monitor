// SPDX-License-Identifier: GPL-2.0-or-later
import { GLibClock } from '../../src/adapters/glib-clock.js';
import { assert, test } from './harness.js';
import { eventually, sleep, trackingSources } from './support.js';

// Test seam the implementer must add: `pendingCount`, the number of timers the clock still
// retains (scheduled, not yet fired, not cancelled, not disposed).
const pending = (clock: GLibClock): number | undefined =>
    (clock as unknown as { pendingCount?: number }).pendingCount;

const fired = (count: () => number, expected: number): Promise<true> =>
    eventually(() => (count() === expected ? true : undefined));

test('clock: a timer fires its callback once after the delay', async () => {
    const clock = new GLibClock();
    let count = 0;
    clock.setTimeout(20, () => {
        count++;
    });
    await fired(() => count, 1);
    await sleep(100);
    assert.equal(count, 1, 'a callback that returned CONTINUE would fire repeatedly');
    clock.dispose();
});

test('clock: a cancelled timer never fires', async () => {
    const clock = new GLibClock();
    let count = 0;
    const cancel = clock.setTimeout(20, () => {
        count++;
    });
    cancel();
    await sleep(80);
    assert.equal(count, 0);
    clock.dispose();
});

test('clock: cancelling twice is a no-op and leaves other timers alone', async () => {
    const clock = new GLibClock();
    let count = 0;
    const cancel = clock.setTimeout(20, () => undefined);
    cancel();
    // Source IDs are reused, so a second cancel must not remove this newer timer.
    clock.setTimeout(40, () => {
        count++;
    });
    cancel();
    await fired(() => count, 1);
    clock.dispose();
});

test('clock: cancelling after the timer fired does not remove a timer that reused its ID', async () => {
    const clock = new GLibClock();
    let first = 0;
    const cancelFirst = clock.setTimeout(10, () => {
        first++;
    });
    await fired(() => first, 1);
    let count = 0;
    for (let i = 0; i < 5; i++) {
        clock.setTimeout(40, () => {
            count++;
        });
    }
    cancelFirst();
    await fired(() => count, 5);
    clock.dispose();
});

test('clock: a timer may schedule another from its callback', async () => {
    const clock = new GLibClock();
    let order = '';
    clock.setTimeout(10, () => {
        order += 'a';
        clock.setTimeout(10, () => {
            order += 'b';
        });
    });
    await eventually(() => (order === 'ab' ? true : undefined));
    clock.dispose();
});

test('clock: dispose removes every pending timer', async () => {
    const clock = new GLibClock();
    let count = 0;
    for (let i = 0; i < 3; i++) {
        clock.setTimeout(30, () => {
            count++;
        });
    }
    clock.dispose();
    await sleep(100);
    assert.equal(count, 0);
});

test('clock: scheduling after dispose never fires, creates no source and cancel stays safe', () =>
    trackingSources(async tracker => {
        const clock = new GLibClock();
        clock.dispose();
        let count = 0;
        const cancel = clock.setTimeout(10, () => {
            count++;
        });
        await sleep(60);
        cancel();
        assert.equal(count, 0);
        assert.equal(tracker.removed.length, 0);
    }));

test('clock: dispose twice is safe', () => {
    const clock = new GLibClock();
    clock.dispose();
    clock.dispose();
});

test('clock: cancelling a timer that already fired never calls GLib.Source.remove', () =>
    trackingSources(async tracker => {
        const clock = new GLibClock();
        let count = 0;
        const cancel = clock.setTimeout(10, () => {
            count++;
        });
        await fired(() => count, 1);
        cancel();
        assert.equal(tracker.removed.length, 0);
        clock.dispose();
    }));

test('clock: cancelling twice removes the source exactly once', () =>
    trackingSources(tracker => {
        const clock = new GLibClock();
        const cancel = clock.setTimeout(1000, () => undefined);
        cancel();
        cancel();
        assert.equal(tracker.removed.length, 1);
        clock.dispose();
    }));

test('clock: dispose after a timer fired does not remove that timer', () =>
    trackingSources(async tracker => {
        const clock = new GLibClock();
        let count = 0;
        clock.setTimeout(10, () => {
            count++;
        });
        await fired(() => count, 1);
        clock.dispose();
        assert.equal(tracker.removed.length, 0);
    }));

test('clock: dispose removes a pending timer once and a cancel handed out earlier is then inert', () =>
    trackingSources(tracker => {
        const clock = new GLibClock();
        const cancel = clock.setTimeout(1000, () => undefined);
        clock.dispose();
        assert.equal(tracker.removed.length, 1);
        cancel();
        assert.equal(tracker.removed.length, 1, 'the source was already removed by dispose');
    }));

test('clock: a delay of 2**32 or Infinity is not immediate and does not throw', async () => {
    const clock = new GLibClock();
    let count = 0;
    for (const ms of [2 ** 32, Infinity]) {
        clock.setTimeout(ms, () => {
            count++;
        });
    }
    await sleep(100);
    assert.equal(count, 0);
    clock.dispose();
});

test('clock: a NaN or negative delay does not throw and fires promptly', async () => {
    const clock = new GLibClock();
    let count = 0;
    for (const ms of [NaN, -5, -Infinity]) {
        clock.setTimeout(ms, () => {
            count++;
        });
    }
    await fired(() => count, 3);
    clock.dispose();
});

test('clock: delays are clamped to the range GLib accepts', () =>
    trackingSources(tracker => {
        const clock = new GLibClock();
        for (const ms of [2 ** 32, Infinity, NaN, -5, 1.6]) clock.setTimeout(ms, () => undefined);
        assert.deepEqual(tracker.intervals, [2 ** 31 - 1, 2 ** 31 - 1, 0, 0, 2]);
        clock.dispose();
    }));

test('clock: now() is monotonic milliseconds that advance by at least the time slept', async () => {
    const clock = new GLibClock();
    const before = clock.now();
    await sleep(60);
    const after = clock.now();
    assert.ok(
        after - before >= 50,
        `expected at least 50 ms to pass, got ${String(after - before)}`,
    );
    assert.ok(clock.now() >= after);
    clock.dispose();
});

test('clock: pendingCount counts scheduled timers and drops to 0 after dispose', () => {
    const clock = new GLibClock();
    assert.equal(pending(clock), 0);
    clock.setTimeout(1000, () => undefined);
    clock.setTimeout(1000, () => undefined);
    assert.equal(pending(clock), 2);
    clock.dispose();
    assert.equal(pending(clock), 0);
});

test('clock: a timer that fired is no longer retained', async () => {
    const clock = new GLibClock();
    let count = 0;
    clock.setTimeout(10, () => {
        count++;
    });
    assert.equal(pending(clock), 1);
    await fired(() => count, 1);
    assert.equal(pending(clock), 0);
    clock.dispose();
});

test('clock: a cancelled timer is no longer retained', () => {
    const clock = new GLibClock();
    const cancel = clock.setTimeout(1000, () => undefined);
    cancel();
    assert.equal(pending(clock), 0);
    clock.dispose();
});
