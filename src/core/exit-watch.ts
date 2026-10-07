// SPDX-License-Identifier: GPL-2.0-or-later
import { instanceKey, type Instance, type InstanceStatus } from './incus/models.js';
import type { Snapshot } from './monitor.js';

/**
 * Finds running instances that stopped between two polls without a menu action. Incus does not
 * say whether a stop was a crash, a kill or a command in a terminal, so all of them are reported.
 */
export class ExitWatch {
    // Statuses of the previous list; null until a list has been seen, and again after a gap in
    // the data, so a reconnect never reports what happened while the monitor was blind.
    #last: ReadonlyMap<string, InstanceStatus> | null = null;

    /** Returns the instances that left `running` for `stopped` or `error`, in snapshot order. */
    observe(snapshot: Snapshot, inFlightKeys: ReadonlySet<string>): readonly Instance[] {
        const instances = listOf(snapshot);
        if (instances === null) {
            this.#last = null;
            return [];
        }
        const previous = this.#last;
        this.#last = new Map(instances.map(i => [instanceKey(i), i.status]));
        if (previous === null) return [];
        return instances.filter(i => {
            const key = instanceKey(i);
            return (
                previous.get(key) === 'running' &&
                (i.status === 'stopped' || i.status === 'error') &&
                !inFlightKeys.has(key)
            );
        });
    }
}

function listOf(snapshot: Snapshot): readonly Instance[] | null {
    switch (snapshot.kind) {
        case 'ready':
            return snapshot.instances;
        case 'refreshing':
            return snapshot.previous;
        case 'idle':
        case 'connecting':
        case 'failed':
            return null;
    }
}
