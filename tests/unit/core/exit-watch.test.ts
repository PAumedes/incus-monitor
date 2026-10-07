// SPDX-License-Identifier: GPL-2.0-or-later
import { beforeEach, describe, expect, it } from 'vitest';

import { ExitWatch } from '../../../src/core/exit-watch.js';
import { instanceKey, type Instance, type InstanceStatus } from '../../../src/core/incus/models.js';
import type { Snapshot } from '../../../src/core/monitor.js';

function inst(name: string, status: InstanceStatus, project = 'default'): Instance {
    return { project, name, type: 'container', status, state: null, forwards: [] };
}

const ready = (...instances: Instance[]): Snapshot => ({ kind: 'ready', instances, atMs: 0 });
const refreshing = (...previous: Instance[]): Snapshot => ({ kind: 'refreshing', previous });
const failed: Snapshot = { kind: 'failed', error: { kind: 'unreachable' }, retryInMs: 2000 };
const NONE = (): boolean => false;
const names = (found: readonly Instance[]): string[] => found.map(i => i.name);

describe('ExitWatch', () => {
    let watch: ExitWatch;
    beforeEach(() => {
        watch = new ExitWatch();
    });

    it('reports nothing for the first snapshot, even with stopped instances', () => {
        expect(watch.observe(ready(inst('a', 'stopped'), inst('b', 'error')), NONE)).toEqual([]);
    });

    it.each<InstanceStatus>(['stopped', 'error'])(
        'reports an instance that went from running to %s',
        status => {
            watch.observe(ready(inst('a', 'running')), NONE);
            const found = watch.observe(ready(inst('a', status)), NONE);
            expect(found).toEqual([inst('a', status)]);
        },
    );

    it.each<InstanceStatus>(['busy', 'frozen', 'unknown', 'running'])(
        'does not report a running instance that became %s',
        status => {
            watch.observe(ready(inst('a', 'running')), NONE);
            expect(watch.observe(ready(inst('a', status)), NONE)).toEqual([]);
        },
    );

    it.each<InstanceStatus>(['stopped', 'frozen', 'busy', 'error', 'unknown'])(
        'does not report an instance that was %s and is stopped',
        before => {
            watch.observe(ready(inst('a', before)), NONE);
            expect(watch.observe(ready(inst('a', 'stopped')), NONE)).toEqual([]);
        },
    );

    it('does not report a restart that went through busy between two polls', () => {
        watch.observe(ready(inst('a', 'running')), NONE);
        watch.observe(ready(inst('a', 'busy')), NONE);
        expect(watch.observe(ready(inst('a', 'running')), NONE)).toEqual([]);
    });

    it('does not report an instance that vanished', () => {
        watch.observe(ready(inst('a', 'running')), NONE);
        expect(watch.observe(ready(), NONE)).toEqual([]);
    });

    it('does not report a vanished instance that comes back stopped', () => {
        watch.observe(ready(inst('a', 'running')), NONE);
        watch.observe(ready(), NONE);
        expect(watch.observe(ready(inst('a', 'stopped')), NONE)).toEqual([]);
    });

    it('does not report an instance that appeared already stopped', () => {
        watch.observe(ready(inst('a', 'running')), NONE);
        expect(watch.observe(ready(inst('a', 'running'), inst('b', 'stopped')), NONE)).toEqual([]);
    });

    it('reports every instance that stopped in one poll, in snapshot order', () => {
        watch.observe(
            ready(inst('a', 'running'), inst('b', 'running'), inst('c', 'running')),
            NONE,
        );
        const found = watch.observe(
            ready(inst('a', 'stopped'), inst('b', 'running'), inst('c', 'error')),
            NONE,
        );
        expect(names(found)).toEqual(['a', 'c']);
    });

    it('reports an instance once per transition', () => {
        watch.observe(ready(inst('a', 'running')), NONE);
        expect(watch.observe(ready(inst('a', 'stopped')), NONE)).toHaveLength(1);
        expect(watch.observe(ready(inst('a', 'stopped')), NONE)).toEqual([]);
        expect(watch.observe(ready(inst('a', 'error')), NONE)).toEqual([]);
    });

    it('reports an instance again once it was seen running again', () => {
        watch.observe(ready(inst('a', 'running')), NONE);
        watch.observe(ready(inst('a', 'stopped')), NONE);
        watch.observe(ready(inst('a', 'running')), NONE);
        expect(names(watch.observe(ready(inst('a', 'stopped')), NONE))).toEqual(['a']);
    });

    it('tells instances with the same name in different projects apart', () => {
        watch.observe(ready(inst('a', 'running', 'p1'), inst('a', 'running', 'p2')), NONE);
        const found = watch.observe(
            ready(inst('a', 'running', 'p1'), inst('a', 'stopped', 'p2')),
            NONE,
        );
        expect(found.map(i => i.project)).toEqual(['p2']);
    });

    describe('actions in flight', () => {
        it('skips a key with an action in flight', () => {
            watch.observe(ready(inst('a', 'running'), inst('b', 'running')), NONE);
            const found = watch.observe(
                ready(inst('a', 'stopped'), inst('b', 'stopped')),
                key => key === instanceKey(inst('a', 'running')),
            );
            expect(names(found)).toEqual(['b']);
        });

        it('does not report a skipped transition once the action has finished', () => {
            watch.observe(ready(inst('a', 'running')), NONE);
            watch.observe(
                ready(inst('a', 'stopped')),
                key => key === instanceKey(inst('a', 'running')),
            );
            expect(watch.observe(ready(inst('a', 'stopped')), NONE)).toEqual([]);
        });

        it('reports a later stop of an instance whose menu start has finished', () => {
            watch.observe(ready(inst('a', 'stopped')), NONE);
            watch.observe(
                ready(inst('a', 'running')),
                key => key === instanceKey(inst('a', 'running')),
            );
            watch.observe(ready(inst('a', 'running')), NONE);
            expect(names(watch.observe(ready(inst('a', 'stopped')), NONE))).toEqual(['a']);
        });

        it('keys the in-flight set by project and name', () => {
            watch.observe(ready(inst('a', 'running', 'p2')), NONE);
            const found = watch.observe(
                ready(inst('a', 'stopped', 'p2')),
                key => key === instanceKey(inst('a', 'running', 'p1')),
            );
            expect(names(found)).toEqual(['a']);
        });
    });

    describe('snapshots without a list', () => {
        it('compares against a refreshing snapshot that carries its previous list', () => {
            watch.observe(ready(inst('a', 'running')), NONE);
            expect(watch.observe(refreshing(inst('a', 'running')), NONE)).toEqual([]);
            expect(names(watch.observe(ready(inst('a', 'stopped')), NONE))).toEqual(['a']);
        });

        it('reports a stop first seen in a refreshing snapshot', () => {
            watch.observe(ready(inst('a', 'running')), NONE);
            expect(names(watch.observe(refreshing(inst('a', 'stopped')), NONE))).toEqual(['a']);
        });

        it.each<[string, Snapshot]>([
            ['idle', { kind: 'idle' }],
            ['connecting', { kind: 'connecting' }],
            ['failed', failed],
        ])(
            'forgets everything on a %s snapshot, so a reconnect reports nothing',
            (_n, snapshot) => {
                watch.observe(ready(inst('a', 'running')), NONE);
                expect(watch.observe(snapshot, NONE)).toEqual([]);
                expect(watch.observe(ready(inst('a', 'stopped')), NONE)).toEqual([]);
            },
        );

        it('reports a stop that happens after the reconnect snapshot', () => {
            watch.observe(ready(inst('a', 'running')), NONE);
            watch.observe(failed, NONE);
            watch.observe(ready(inst('a', 'running')), NONE);
            expect(names(watch.observe(ready(inst('a', 'stopped')), NONE))).toEqual(['a']);
        });
    });
});
