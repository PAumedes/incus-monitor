// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';

import {
    ACTIONS,
    actionsFor,
    isActionAvailable,
    type InstanceAction,
} from '../../../../src/core/incus/actions.js';
import type { InstanceStatus } from '../../../../src/core/incus/models.js';

describe('actionsFor', () => {
    // The status table of UI_DESIGN.md, in menu order. A frozen instance may be stopped.
    it.each<[InstanceStatus, readonly InstanceAction[]]>([
        ['running', ['stop', 'restart', 'freeze']],
        ['frozen', ['unfreeze', 'stop']],
        ['stopped', ['start']],
        ['busy', []],
        ['error', []],
        ['unknown', []],
    ])('lists the actions of a %s instance in menu order', (status, expected) => {
        expect(actionsFor(status)).toEqual(expected);
    });

    it('gives no action for a status it does not know', () => {
        expect(actionsFor('exploded' as InstanceStatus)).toEqual([]);
    });
});

describe('isActionAvailable', () => {
    it.each<[InstanceAction, InstanceStatus, boolean]>([
        ['start', 'stopped', true],
        ['start', 'running', false],
        ['stop', 'running', true],
        ['stop', 'frozen', true],
        ['stop', 'stopped', false],
        ['restart', 'running', true],
        ['restart', 'frozen', false],
        ['freeze', 'running', true],
        ['freeze', 'frozen', false],
        ['unfreeze', 'frozen', true],
        ['unfreeze', 'running', false],
        ['stop', 'busy', false],
    ])('%s on a %s instance is %s', (action, status, expected) => {
        expect(isActionAvailable(action, status)).toBe(expected);
    });

    it('agrees with actionsFor for every action and status', () => {
        const statuses: InstanceStatus[] = [
            'running',
            'frozen',
            'stopped',
            'busy',
            'error',
            'unknown',
        ];
        for (const status of statuses) {
            expect(ACTIONS.filter(a => isActionAvailable(a, status))).toEqual(actionsFor(status));
        }
    });
});

describe('ACTIONS', () => {
    it('is the menu order', () => {
        expect(ACTIONS).toEqual(['start', 'unfreeze', 'stop', 'restart', 'freeze']);
    });
});
