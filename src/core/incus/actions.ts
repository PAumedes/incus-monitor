// SPDX-License-Identifier: GPL-2.0-or-later
import type { InstanceStatus } from './models.js';

// Menu order: the presenter lists the actions of a status in this order.
export const ACTIONS = ['start', 'unfreeze', 'stop', 'restart', 'freeze'] as const;
export type InstanceAction = (typeof ACTIONS)[number];

// The statuses each action may start from. Gates Monitor.perform and drives the menu.
const ALLOWED_STATUSES: Readonly<Record<InstanceAction, readonly InstanceStatus[]>> = {
    start: ['stopped'],
    stop: ['running', 'frozen'],
    restart: ['running'],
    freeze: ['running'],
    unfreeze: ['frozen'],
};

export function isActionAvailable(action: InstanceAction, status: InstanceStatus): boolean {
    return ALLOWED_STATUSES[action].includes(status);
}

export function actionsFor(status: InstanceStatus): readonly InstanceAction[] {
    return ACTIONS.filter(action => isActionAvailable(action, status));
}
