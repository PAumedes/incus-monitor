// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';

import type { IncusError } from '../../../src/core/errors.js';
import { Formatter } from '../../../src/core/format.js';
import type { InstanceAction } from '../../../src/core/incus/actions.js';
import type {
    Instance,
    InstanceRef,
    InstanceState,
    InstanceStatus,
} from '../../../src/core/incus/models.js';
import type { Snapshot } from '../../../src/core/monitor.js';
import {
    performFailureMessage,
    performFailureTitle,
    present,
    type PresentContext,
    type Row,
} from '../../../src/core/presenter.js';
import { NO_RATES, Sampler, type LiveRates } from '../../../src/core/sampler.js';

const NBSP = ' ';
const nb = (text: string): string => text.replace(' ', NBSP);
const identity = (msgid: string): string => msgid;

// Every user-visible string must pass through these: the markers make a bypass visible.
const translate = (msgid: string): string => `[${msgid}]`;
// Distinct singular and plural text, so a wrong branch or a swapped argument shows.
const ngettext = (singular: string, plural: string, n: number): string =>
    n === 1 ? `one:${singular}` : `many:${plural}`;

const WALL_NOW_MS = Date.parse('2026-10-05T04:06:39.144Z');
const STARTED_AT_MS = Date.parse('2026-10-05T00:54:39.144Z'); // 3 h 12 min before WALL_NOW_MS

const PANEL = 'package-x-generic-symbolic';
const WARNING = 'dialog-warning-symbolic';

const RUNNING_STATE: InstanceState = {
    cpuUsageNs: 4_020_256_000,
    cpuAllocatedNsPerSecond: 4_000_000_000,
    memoryUsageBytes: 246_255_616,
    memoryTotalBytes: 2_000_000_000,
    rxBytes: 20_513,
    txBytes: 766,
    processes: 204,
    startedAtMs: STARTED_AT_MS,
    primaryAddress: '10.0.3.15',
};

function instance(overrides: Partial<Instance> = {}): Instance {
    return {
        project: 'default',
        name: 'web01',
        type: 'container',
        status: 'running',
        state: RUNNING_STATE,
        ...overrides,
    };
}

function withState(overrides: Partial<InstanceState>, rest: Partial<Instance> = {}): Instance {
    return instance({ state: { ...RUNNING_STATE, ...overrides }, ...rest });
}

const ready = (...instances: Instance[]): Snapshot => ({ kind: 'ready', instances, atMs: 1000 });

function context(overrides: Partial<PresentContext> = {}): PresentContext {
    return {
        formatter: new Formatter('en', identity),
        locale: 'en',
        translate,
        ngettext,
        samples: { rates: () => NO_RATES },
        wallNowMs: WALL_NOW_MS,
        showStopped: true,
        ...overrides,
    };
}

function listOf(snapshot: Snapshot, overrides: Partial<PresentContext> = {}) {
    const vm = present(snapshot, context(overrides));
    if (vm.kind !== 'list') throw new Error(`expected a list, got ${vm.kind}`);
    return vm;
}

function rowsOf(instances: Instance[], overrides: Partial<PresentContext> = {}): readonly Row[] {
    return listOf(ready(...instances), overrides).rows;
}

function onlyRow(item: Instance, overrides: Partial<PresentContext> = {}): Row {
    const [row, ...rest] = rowsOf([item], overrides);
    if (row === undefined || rest.length > 0) throw new Error('expected exactly one row');
    return row;
}

const lifecycle = (action: string, label: string, icon: string) => ({
    kind: 'lifecycle',
    action,
    label: `[${label}]`,
    icon,
});
const terminal = (target: string, label: string) => ({
    kind: 'terminal',
    target,
    label: `[${label}]`,
});
const START = lifecycle('start', 'Start', 'media-playback-start-symbolic');
const STOP = lifecycle('stop', 'Stop', 'media-playback-stop-symbolic');
const RESTART = lifecycle('restart', 'Restart', 'system-reboot-symbolic');
const FREEZE = lifecycle('freeze', 'Freeze', 'media-playback-pause-symbolic');
const UNFREEZE = lifecycle('unfreeze', 'Unfreeze', 'media-playback-start-symbolic');
const SHELL = terminal('shell', 'Open Shell');
const CONSOLE = terminal('console', 'Open Console');

describe('present: row identity and labels', () => {
    it('keys a row by project and name and labels it with the instance name', () => {
        const row = onlyRow(instance({ project: 'lab', name: 'web01' }));
        expect(row.key).toBe('lab/web01');
        expect(row.name).toBe('web01');
    });

    it('hides the project label when every instance is in one project', () => {
        const rows = rowsOf([instance({ name: 'a' }), instance({ name: 'b' })]);
        expect(rows.map(r => r.project)).toEqual([null, null]);
    });

    it('shows the project label on every row when instances span projects', () => {
        const rows = rowsOf([
            instance({ project: 'default', name: 'a' }),
            instance({ project: 'lab', name: 'b' }),
        ]);
        expect(rows.map(r => r.project)).toEqual(['default', 'lab']);
    });

    it('counts projects over the visible rows only', () => {
        const rows = rowsOf(
            [
                instance({ project: 'default', name: 'a' }),
                instance({ project: 'lab', name: 'b', status: 'stopped', state: null }),
            ],
            { showStopped: false },
        );
        expect(rows.map(r => r.project)).toEqual([null]);
    });

    it.each<[Instance['type'], string]>([
        ['container', 'package-x-generic-symbolic'],
        ['virtual-machine', 'computer-symbolic'],
    ])('uses the %s type icon', (type, icon) => {
        expect(onlyRow(instance({ type })).typeIcon).toBe(icon);
    });
});

describe('present: status dot, status text and accessible name', () => {
    // status, dot class, translated state word. busy and unknown use the nearest neutral class.
    it.each<[InstanceStatus, string, string]>([
        ['running', 'running', '[Running]'],
        ['frozen', 'frozen', '[Frozen]'],
        ['stopped', 'stopped', '[Stopped]'],
        ['error', 'error', '[Error]'],
        ['busy', 'frozen', '[Busy]'],
        ['unknown', 'stopped', '[Unknown]'],
    ])('maps status %s to dot %s and text %s', (status, dot, text) => {
        const row = onlyRow(instance({ status, state: null }));
        expect(row.dot).toBe(dot);
        expect(row.statusText).toBe(text);
    });

    it.each<InstanceStatus>(['running', 'frozen', 'stopped', 'error', 'busy', 'unknown'])(
        'puts the translated state word and the name in the accessible name of a %s row',
        status => {
            const row = onlyRow(instance({ status, name: 'web01', state: null }));
            expect(row.accessibleName).toContain(row.statusText);
            expect(row.accessibleName).toContain('web01');
        },
    );
});

describe('present: accessible name with project', () => {
    it('includes the project when the rows span projects', () => {
        const rows = rowsOf([
            instance({ project: 'default', name: 'a' }),
            instance({ project: 'lab', name: 'b' }),
        ]);
        expect(rows.map(r => r.accessibleName)).toEqual([
            '[a, default, [Running]]',
            '[b, lab, [Running]]',
        ]);
    });

    it('omits the project when it is hidden', () => {
        expect(onlyRow(instance({ name: 'a' })).accessibleName).toBe('[a, [Running]]');
    });

    it('keeps a placeholder-like name literal in the accessible name', () => {
        const row = onlyRow(instance({ name: '$&{status}' }));
        expect(row.accessibleName).toBe('[$&{status}, [Running]]');
    });

    it.each(['constructor', 'toString', '__proto__'])(
        'leaves a template placeholder named %s literal',
        key => {
            const row = onlyRow(instance(), {
                translate: msgid => (msgid === '{name}, {status}' ? `{${key}}|{name}` : msgid),
            });
            expect(row.accessibleName).toBe(`{${key}}|web01`);
        },
    );
});

describe('present: ordering', () => {
    const names = (rows: readonly Row[]): string[] => rows.map(r => r.name);

    it('orders running, then frozen, then stopped, then other states', () => {
        const rows = rowsOf([
            instance({ name: 'a-unknown', status: 'unknown', state: null }),
            instance({ name: 'b-stopped', status: 'stopped', state: null }),
            instance({ name: 'c-error', status: 'error', state: null }),
            instance({ name: 'd-frozen', status: 'frozen', state: null }),
            instance({ name: 'e-busy', status: 'busy', state: null }),
            instance({ name: 'f-running', status: 'running' }),
        ]);
        expect(names(rows)).toEqual([
            'f-running',
            'd-frozen',
            'b-stopped',
            'a-unknown',
            'c-error',
            'e-busy',
        ]);
    });

    it('orders by name inside a state, ignoring case', () => {
        const rows = rowsOf(['zeta', 'Alpha', 'emile', 'Emma'].map(name => instance({ name })));
        expect(names(rows)).toEqual(['Alpha', 'emile', 'Emma', 'zeta']);
    });

    it('orders names that differ only by case the same whatever order Incus returned', () => {
        const lower = instance({ name: 'web' });
        const upper = instance({ name: 'Web' });
        expect(names(rowsOf([lower, upper]))).toEqual(names(rowsOf([upper, lower])));
    });

    it('orders with a POSIX locale as it does with English', () => {
        const items = ['b', 'a'].map(name => instance({ name }));
        expect(names(rowsOf(items, { locale: 'C' }))).toEqual(['a', 'b']);
    });

    it('puts a lower-case name before its capitalised twin, whatever the letters around them', () => {
        const rows = rowsOf(['b', 'B', 'a', 'A'].map(name => instance({ name })));
        expect(names(rows)).toEqual(['A', 'a', 'B', 'b']);
    });

    it('orders a name tie by project ignoring case', () => {
        const rows = rowsOf([
            instance({ project: 'Z', name: 'web' }),
            instance({ project: 'a', name: 'web' }),
        ]);
        expect(rows.map(r => r.key)).toEqual(['a/web', 'Z/web']);
    });

    it('orders projects that differ only by case the same whatever order Incus returned', () => {
        const lower = instance({ project: 'lab', name: 'web' });
        const upper = instance({ project: 'Lab', name: 'web' });
        const keys = (items: Instance[]): string[] => rowsOf(items).map(r => r.key);
        expect(keys([lower, upper])).toEqual(['Lab/web', 'lab/web']);
        expect(keys([upper, lower])).toEqual(['Lab/web', 'lab/web']);
    });

    it('breaks a name tie by project', () => {
        const rows = rowsOf([
            instance({ project: 'lab', name: 'web' }),
            instance({ project: 'default', name: 'web' }),
        ]);
        expect(rows.map(r => r.key)).toEqual(['default/web', 'lab/web']);
    });

    it('does not depend on the order Incus returned', () => {
        const a = instance({ name: 'a' });
        const b = instance({ name: 'b', status: 'stopped', state: null });
        expect(rowsOf([a, b])).toEqual(rowsOf([b, a]));
    });
});

describe('present: show-stopped filter', () => {
    const mixed = [
        instance({ name: 'up' }),
        instance({ name: 'cold', status: 'stopped', state: null }),
        instance({ name: 'ice', status: 'frozen', state: null }),
    ];

    it('keeps stopped instances when the setting is on', () => {
        expect(rowsOf(mixed, { showStopped: true }).map(r => r.name)).toEqual([
            'up',
            'ice',
            'cold',
        ]);
    });

    it('drops only stopped instances when the setting is off', () => {
        expect(rowsOf(mixed, { showStopped: false }).map(r => r.name)).toEqual(['up', 'ice']);
    });

    it('shows a No running instances notice when every instance is stopped and hidden', () => {
        const vm = present(
            ready(instance({ name: 'cold', status: 'stopped', state: null })),
            context({ showStopped: false }),
        );
        expect(vm).toEqual({
            kind: 'notice',
            text: '[No running instances]',
            action: null,
            panelIcon: PANEL,
            panelAccessibleName: '[Incus]',
        });
    });
});

describe('present: readout', () => {
    it('shows CPU percent and memory for a running instance', () => {
        const rates: LiveRates = { cpuPercent: 4, network: null };
        const row = onlyRow(instance(), { samples: { rates: () => rates } });
        expect(row.readout).toEqual({ cpu: '4%', memory: nb('246 MB') });
    });

    it('shows a dash for CPU before a second sample exists', () => {
        expect(onlyRow(instance()).readout).toEqual({ cpu: '—', memory: nb('246 MB') });
    });

    it('has no readout when the list came without state', () => {
        expect(onlyRow(instance({ state: null })).readout).toBeNull();
    });

    it.each<InstanceStatus>(['frozen', 'stopped', 'busy', 'error', 'unknown'])(
        'has no readout for a %s instance even if state is present',
        status => {
            expect(onlyRow(instance({ status })).readout).toBeNull();
        },
    );

    it('shows the rates of a real sampler for the row', () => {
        const sampler = new Sampler();
        const at = (atMs: number, cpuUsageNs: number): Snapshot => ({
            kind: 'ready',
            instances: [withState({ cpuUsageNs })],
            atMs,
        });
        sampler.record(at(0, 1_000_000_000));
        sampler.record(at(1000, 1_160_000_000));
        const row = onlyRow(instance(), { samples: sampler });
        expect(row.readout?.cpu).toBe('4%');
    });

    it('shows a dash, not 0% or NaN, for an instance whose CPU usage is not available', () => {
        const sampler = new Sampler();
        const unavailable = { ...RUNNING_STATE, cpuUsageNs: -1 };
        const at = (atMs: number): Snapshot => ({
            kind: 'ready',
            instances: [withState({ cpuUsageNs: unavailable.cpuUsageNs })],
            atMs,
        });
        sampler.record(at(0));
        sampler.record(at(1000));
        const row = onlyRow(instance({ state: unavailable }), { samples: sampler });
        expect(row.readout).toEqual({ cpu: '—', memory: nb('246 MB') });
    });
});

describe('present: actions', () => {
    // The status table of UI_DESIGN.md.
    it.each<[InstanceStatus, readonly unknown[]]>([
        ['running', [STOP, RESTART, FREEZE, SHELL]],
        ['frozen', [UNFREEZE, STOP]],
        ['stopped', [START]],
        ['busy', []],
        ['error', []],
        ['unknown', []],
    ])('offers the valid actions for a %s instance', (status, expected) => {
        expect(onlyRow(instance({ status })).actions).toEqual(expected);
    });

    it('offers Open Console for a VM that reports no process count', () => {
        const vm = withState({ processes: -1 }, { type: 'virtual-machine' });
        expect(onlyRow(vm).actions).toEqual([STOP, RESTART, FREEZE, CONSOLE]);
    });

    it.each<[string, Instance]>([
        ['a VM with an agent', withState({ processes: 12 }, { type: 'virtual-machine' })],
        ['a container reporting no count', withState({ processes: -1 })],
        ['a container listed without state', instance({ state: null })],
        [
            'a VM with exactly zero processes',
            withState({ processes: 0 }, { type: 'virtual-machine' }),
        ],
    ])('offers Open Shell for %s', (_label, item) => {
        expect(onlyRow(item).actions).toEqual([STOP, RESTART, FREEZE, SHELL]);
    });

    it('offers no terminal action for a running VM listed without state', () => {
        const vm = instance({ type: 'virtual-machine', state: null });
        expect(onlyRow(vm).actions).toEqual([STOP, RESTART, FREEZE]);
    });

    it('offers Open Console at -1 processes and Open Shell at 0', () => {
        const last = [-1, 0].map(processes =>
            onlyRow(withState({ processes }, { type: 'virtual-machine' })).actions.at(-1),
        );
        expect(last).toEqual([CONSOLE, SHELL]);
    });

    it('marks transitional rows busy and others not busy', () => {
        expect(onlyRow(instance({ status: 'busy', state: null })).busy).toBe(true);
        expect(onlyRow(instance({ status: 'running' })).busy).toBe(false);
        expect(onlyRow(instance({ status: 'stopped', state: null })).busy).toBe(false);
    });
});

describe('present: details', () => {
    it('shows memory as used of total when the total is known', () => {
        const row = onlyRow(instance());
        expect(row.details?.memory).toBe(`[${nb('246 MB')} of ${nb('2.0 GB')}]`);
    });

    it('shows only the used memory when no total is reported', () => {
        const row = onlyRow(withState({ memoryTotalBytes: 0 }));
        expect(row.details?.memory).toBe(nb('246 MB'));
    });

    it('formats network rates from the sampler', () => {
        const rates: LiveRates = {
            cpuPercent: 4,
            network: { rxBytesPerSecond: 12_000, txBytesPerSecond: 1500 },
        };
        const row = onlyRow(instance(), { samples: { rates: () => rates } });
        expect(row.details?.network).toEqual({ down: nb('12 kB/s'), up: nb('1.5 kB/s') });
    });

    it('shows a dash for each network rate before a second sample exists', () => {
        expect(onlyRow(instance()).details?.network).toEqual({ down: '—', up: '—' });
    });

    it('shows the address and the uptime from the start time and the wall clock', () => {
        const details = onlyRow(instance()).details;
        expect(details?.address).toBe('10.0.3.15');
        expect(details?.uptime).toBe('3 h 12 min');
    });

    it.each([
        ['address', { primaryAddress: null }, 'address'],
        ['uptime without a start time', { startedAtMs: null }, 'uptime'],
        ['uptime with a start time in the future', { startedAtMs: WALL_NOW_MS + 60_000 }, 'uptime'],
    ] as const)('shows a dash for an unknown %s', (_label, override, field) => {
        expect(onlyRow(withState(override)).details?.[field]).toBe('—');
    });

    it('renders an uptime of exactly zero rather than a dash', () => {
        const row = onlyRow(withState({ startedAtMs: WALL_NOW_MS }));
        expect(row.details?.uptime).toBe('< 1 min');
    });

    it('always has strings for network, address and uptime so the layout does not jump', () => {
        const details = onlyRow(withState({ primaryAddress: null, startedAtMs: null })).details;
        expect([
            typeof details?.network.down,
            typeof details?.network.up,
            typeof details?.address,
            typeof details?.uptime,
        ]).toEqual(['string', 'string', 'string', 'string']);
    });

    it.each<[string, Instance]>([
        ['without state', instance({ state: null })],
        ['stopped', instance({ status: 'stopped' })],
        ['frozen', instance({ status: 'frozen' })],
        ['busy', instance({ status: 'busy' })],
    ])('has no details for an instance that is %s', (_label, item) => {
        expect(onlyRow(item).details).toBeNull();
    });
});

describe('present: panel', () => {
    it('counts only running instances, not the stopped ones the filter hides', () => {
        const vm = listOf(
            ready(
                instance({ name: 'a' }),
                instance({ name: 'b' }),
                instance({ name: 'c', status: 'stopped', state: null }),
            ),
            { showStopped: false },
        );
        expect(vm.runningCount).toBe(2);
    });

    it.each([
        [0, 'many:Incus, {count} running'],
        [1, 'one:Incus, {count} running'],
        [3, 'many:Incus, {count} running'],
    ])('names the panel button for %i running through ngettext', (count, expected) => {
        const items = Array.from({ length: count }, (_v, i) => instance({ name: `i${String(i)}` }));
        const vm = listOf(
            ready(...items, instance({ name: 'zz', status: 'stopped', state: null })),
        );
        // The count is substituted after translation, so the marker wraps the substituted text.
        expect(vm.panelAccessibleName).toBe(expected.replace('{count}', String(count)));
    });

    it('formats the running count with the locale digits', () => {
        const vm = listOf(
            ready(instance({ name: 'a' }), instance({ name: 'b' }), instance({ name: 'c' })),
            { locale: 'ar-EG' },
        );
        expect(vm.panelAccessibleName).toBe('many:Incus, \u0663 running');
    });

    it('uses the normal icon for a list', () => {
        expect(listOf(ready(instance())).panelIcon).toBe(PANEL);
    });

    it('presents a refreshing snapshot like the ready one it replaced', () => {
        const items = [instance()];
        expect(present({ kind: 'refreshing', previous: items }, context())).toEqual(
            present(ready(...items), context()),
        );
    });
});

describe('present: notices and neutral states', () => {
    const failed = (error: IncusError): Snapshot => ({ kind: 'failed', error, retryInMs: 2000 });

    // The error table of UI_DESIGN.md.
    it.each<[string, IncusError, string, 'retry' | null]>([
        ['not installed', { kind: 'not-installed' }, 'Incus is not installed', null],
        [
            'permission denied',
            { kind: 'permission-denied' },
            'Add your user to the "incus" group, then log in again',
            null,
        ],
        ['unreachable', { kind: 'unreachable' }, 'Incus is not responding', 'retry'],
        ['timeout', { kind: 'timeout' }, 'Incus is not responding', 'retry'],
        ['protocol', { kind: 'protocol', detail: 'x' }, 'Incus is not responding', 'retry'],
        ['decode', { kind: 'decode', path: 'a', detail: 'b' }, 'Incus is not responding', 'retry'],
        ['api', { kind: 'api', code: 500, message: 'boom' }, 'Incus is not responding', 'retry'],
        [
            'unsupported',
            { kind: 'unsupported', reason: 'server 5.0' },
            'Incus 6.0 or later is required',
            null,
        ],
    ])('explains %s with one translated sentence', (_label, error, text, retry) => {
        expect(present(failed(error), context())).toEqual({
            kind: 'notice',
            text: `[${text}]`,
            action: retry,
            panelIcon: WARNING,
            panelAccessibleName: `[Incus, {problem}]`.replace('{problem}', `[${text}]`),
        });
    });

    it('names the panel button for an error from a translated template filled with the notice text', () => {
        const vm = present(failed({ kind: 'not-installed' }), {
            ...context(),
            translate: msgid => (msgid === 'Incus, {problem}' ? '{problem} (Incus)' : msgid),
        });
        expect(vm.panelAccessibleName).toBe('Incus is not installed (Incus)');
    });

    it('never shows the diagnostic text of an error', () => {
        const vm = present(failed({ kind: 'unsupported', reason: 'SECRET-REASON' }), context());
        expect(JSON.stringify(vm)).not.toContain('SECRET-REASON');
    });

    it('shows a notice for a truly empty instance list, with the normal panel icon', () => {
        expect(present(ready(), context())).toEqual({
            kind: 'notice',
            text: '[No instances]',
            action: null,
            panelIcon: PANEL,
            panelAccessibleName: '[Incus]',
        });
    });

    it.each<[string, Snapshot]>([
        ['idle', { kind: 'idle' }],
        ['connecting', { kind: 'connecting' }],
        ['a cancelled failure', failed({ kind: 'cancelled' })],
    ])('is a neutral loading state, with no error, for %s', (_label, snapshot) => {
        expect(present(snapshot, context())).toEqual({
            kind: 'loading',
            panelIcon: PANEL,
            panelAccessibleName: '[Incus]',
        });
    });
});

describe('present: plain data and structural equality', () => {
    const items = [
        instance({ name: 'a' }),
        instance({ name: 'b', type: 'virtual-machine' }),
        instance({ name: 'c', status: 'stopped', state: null }),
    ];

    it('is deterministic: equal input gives deeply equal view models', () => {
        expect(present(ready(...items), context())).toEqual(present(ready(...items), context()));
    });

    it('survives a JSON round trip, so it holds only plain data', () => {
        const vm = present(ready(...items), context());
        expect(JSON.parse(JSON.stringify(vm))).toEqual(vm);
    });

    it('changes only the row whose readout changed', () => {
        const at = (cpu: number) => ({
            samples: {
                rates: (ref: InstanceRef): LiveRates =>
                    ref.name === 'a' ? { cpuPercent: cpu, network: null } : NO_RATES,
            },
        });
        const before = rowsOf(items, at(4));
        const after = rowsOf(items, at(40));
        expect(after[0]).not.toEqual(before[0]);
        expect(after[1]).toEqual(before[1]);
        expect(after[2]).toEqual(before[2]);
    });
});

describe('performFailureMessage', () => {
    it.each<[string, IncusError, string]>([
        ['not installed', { kind: 'not-installed' }, 'Incus is not installed'],
        [
            'permission denied',
            { kind: 'permission-denied' },
            'Add your user to the "incus" group, then log in again',
        ],
        [
            'unsupported',
            { kind: 'unsupported', reason: 'stop is not available for this instance' },
            'This action is not available for this instance',
        ],
    ])('gives fixed translated text for %s', (_label, error, text) => {
        expect(performFailureMessage(error, translate)).toBe(`[${text}]`);
    });

    it.each<[string, IncusError]>([
        ['timeout', { kind: 'timeout' }],
        ['protocol', { kind: 'protocol', detail: 'd' }],
        ['decode', { kind: 'decode', path: 'p', detail: 'd' }],
        ['unreachable', { kind: 'unreachable' }],
    ])('says the result could not be confirmed for %s', (_label, error) => {
        expect(performFailureMessage(error, translate)).toBe(
            '[Could not confirm the result. Check the instance state.]',
        );
    });

    it('never shows the raw reason of an unsupported action', () => {
        const message = performFailureMessage({ kind: 'unsupported', reason: 'RAW' }, translate);
        expect(message).not.toContain('RAW');
    });

    it('shows the Incus message of an api error', () => {
        expect(performFailureMessage({ kind: 'api', code: 409, message: 'Busy' }, translate)).toBe(
            'Busy',
        );
    });

    it('blanks control characters in an api message', () => {
        const error: IncusError = { kind: 'api', code: 500, message: 'a\nb\u001b[31mc' };
        expect(performFailureMessage(error, translate)).not.toMatch(/[\n\p{Cc}]/u);
    });

    it.each(['', '   ', '\n\u001b'])(
        'falls back to the generic text when an api message is blank after sanitising (%j)',
        message => {
            expect(performFailureMessage({ kind: 'api', code: 500, message }, translate)).toBe(
                '[The action failed]',
            );
        },
    );

    it('returns null for a cancelled action, which is never shown', () => {
        expect(performFailureMessage({ kind: 'cancelled' }, translate)).toBeNull();
    });
});

describe('performFailureTitle', () => {
    it.each<[InstanceAction, string]>([
        ['start', 'Could not start {name}'],
        ['stop', 'Could not stop {name}'],
        ['restart', 'Could not restart {name}'],
        ['freeze', 'Could not freeze {name}'],
        ['unfreeze', 'Could not unfreeze {name}'],
    ])('uses one whole-sentence msgid for %s', (action, msgid) => {
        expect(performFailureTitle(action, 'web01', translate)).toBe(
            `[${msgid}]`.replace('{name}', 'web01'),
        );
    });

    it('substitutes the name after translating, so a translation may move it', () => {
        const reordered = (msgid: string): string => `${msgid.replace('Could not ', '')} <-`;
        expect(performFailureTitle('stop', 'web01', reordered)).toBe('stop web01 <-');
    });

    it('keeps a name with replacement patterns literal', () => {
        expect(performFailureTitle('stop', 'a$&b', translate)).toBe('[Could not stop a$&b]');
    });
});
