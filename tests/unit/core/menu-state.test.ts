// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';

import {
    listKeys,
    MenuState,
    orderRows,
    menuToRender,
    planRows,
    rowIsInert,
    structurallyEqual,
} from '../../../src/core/menu-state.js';
import type { Row, ViewModel } from '../../../src/core/presenter.js';

const PANEL = { panelIcon: 'package-x-generic-symbolic', panelAccessibleName: 'Incus' };

function row(overrides: Partial<Row> = {}): Row {
    return {
        key: 'default/web01',
        name: 'web01',
        project: null,
        typeIcon: 'package-x-generic-symbolic',
        dot: 'running',
        statusText: 'Running',
        accessibleName: 'web01, Running',
        busy: false,
        readout: { cpu: '3 %', memory: '246 MB' },
        actions: [],
        details: null,
        ...overrides,
    };
}

const list = (...rows: Row[]): ViewModel => ({
    kind: 'list',
    rows,
    runningCount: rows.length,
    ...PANEL,
});
const loading: ViewModel = { kind: 'loading', ...PANEL };
const notice: ViewModel = { kind: 'notice', text: 'No instances', action: null, ...PANEL };

describe('MenuState pending actions', () => {
    it('reports nothing pending at first', () => {
        expect(new MenuState().isPending('default/web01')).toBe(false);
    });

    it('marks a key pending after begin and clears it after settle', () => {
        const state = new MenuState();
        state.begin('default/web01');
        expect(state.isPending('default/web01')).toBe(true);
        state.settle('default/web01');
        expect(state.isPending('default/web01')).toBe(false);
    });

    it('keeps several rows pending independently', () => {
        const state = new MenuState();
        state.begin('default/a');
        state.begin('default/b');
        state.settle('default/a');
        expect([state.isPending('default/a'), state.isPending('default/b')]).toEqual([false, true]);
    });

    it('ignores settling a key that was never pending', () => {
        const state = new MenuState();
        expect(() => {
            state.settle('default/ghost');
        }).not.toThrow();
    });

    it('prunes pending keys absent from the rendered rows', () => {
        const state = new MenuState();
        state.begin('default/gone');
        state.begin('default/kept');
        state.reconcile(['default/kept']);
        expect([state.isPending('default/gone'), state.isPending('default/kept')]).toEqual([
            false,
            true,
        ]);
    });

    it('prunes every pending key when no rows remain', () => {
        const state = new MenuState();
        state.begin('default/a');
        state.reconcile([]);
        expect(state.isPending('default/a')).toBe(false);
    });
});

describe('MenuState expansion', () => {
    it('starts collapsed', () => {
        expect(new MenuState().isExpanded('default/web01')).toBe(false);
    });

    it('toggles a row open and closed', () => {
        const state = new MenuState();
        state.toggle('default/web01');
        expect(state.isExpanded('default/web01')).toBe(true);
        state.toggle('default/web01');
        expect(state.isExpanded('default/web01')).toBe(false);
    });

    it('keeps a row expanded across a reconcile that still lists it', () => {
        const state = new MenuState();
        state.toggle('default/web01');
        state.reconcile(['default/web01', 'default/other']);
        expect(state.isExpanded('default/web01')).toBe(true);
    });

    it('expands rows independently', () => {
        const state = new MenuState();
        state.toggle('default/a');
        expect(state.isExpanded('default/b')).toBe(false);
    });
});

describe('rowIsInert', () => {
    it.each([
        { busy: false, pending: false, inert: false },
        { busy: true, pending: false, inert: true },
        { busy: false, pending: true, inert: true },
        { busy: true, pending: true, inert: true },
    ])('busy=$busy pending=$pending gives inert=$inert', ({ busy, pending, inert }) => {
        const state = new MenuState();
        if (pending) state.begin('default/web01');
        expect(rowIsInert(row({ busy }), state)).toBe(inert);
    });
});

describe('menuToRender', () => {
    it('renders a list as it is', () => {
        const next = list(row());
        expect(menuToRender(undefined, next)).toBe(next);
    });

    it('renders a notice as it is, even after a list', () => {
        expect(menuToRender(list(row()), notice)).toBe(notice);
    });

    it('renders loading when nothing was rendered before', () => {
        expect(menuToRender(undefined, loading)).toBe(loading);
    });

    it('keeps the previous list while loading', () => {
        const previous = list(row());
        expect(menuToRender(previous, loading)).toBe(previous);
    });

    it('keeps the previous notice while loading', () => {
        expect(menuToRender(notice, loading)).toBe(notice);
    });

    it('shows loading again when the previous render was loading', () => {
        expect(menuToRender(loading, loading)).toBe(loading);
    });
});

describe('structurallyEqual', () => {
    it('treats separately built identical rows as equal', () => {
        expect(structurallyEqual(row(), row())).toBe(true);
    });

    it('detects a changed readout', () => {
        expect(structurallyEqual(row(), row({ readout: { cpu: '4 %', memory: '246 MB' } }))).toBe(
            false,
        );
    });

    it('detects readout appearing or disappearing', () => {
        expect(structurallyEqual(row(), row({ readout: null }))).toBe(false);
    });

    it('detects a changed action list', () => {
        const stop = { kind: 'lifecycle', action: 'stop', label: 'Stop', icon: 'x' } as const;
        expect(structurallyEqual(row({ actions: [stop] }), row({ actions: [] }))).toBe(false);
    });

    it('detects a changed nested detail', () => {
        const details = (up: string): Row['details'] => ({
            memory: '1 MB',
            disk: null,
            network: { down: '0 B/s', up },
            address: '10.0.3.15',
            uptime: '1 min',
        });
        expect(
            structurallyEqual(row({ details: details('1') }), row({ details: details('2') })),
        ).toBe(false);
    });

    it('detects a disk detail that appears', () => {
        const details = (disk: string | null): Row['details'] => ({
            memory: '1 MB',
            disk,
            network: { down: '0 B/s', up: '0 B/s' },
            address: '10.0.3.15',
            uptime: '1 min',
        });
        expect(
            structurallyEqual(row({ details: details(null) }), row({ details: details('5 MB') })),
        ).toBe(false);
    });

    it('is not fooled by arrays of different length', () => {
        expect(structurallyEqual([1, 2], [1, 2, 3])).toBe(false);
    });
});

describe('planRows', () => {
    it.each([
        { name: 'identical', prev: ['a', 'b'], next: ['a', 'b'], create: [], destroy: [] },
        {
            name: 'insert at top',
            prev: ['a', 'b'],
            next: ['n', 'a', 'b'],
            create: ['n'],
            destroy: [],
        },
        {
            name: 'remove from middle',
            prev: ['a', 'b', 'c'],
            next: ['a', 'c'],
            create: [],
            destroy: ['b'],
        },
        { name: 'reorder', prev: ['a', 'b', 'c'], next: ['c', 'a', 'b'], create: [], destroy: [] },
        {
            name: 'all replaced',
            prev: ['a', 'b'],
            next: ['x', 'y'],
            create: ['x', 'y'],
            destroy: ['a', 'b'],
        },
        { name: 'empty to some', prev: [], next: ['a', 'b'], create: ['a', 'b'], destroy: [] },
        { name: 'some to empty', prev: ['a', 'b'], next: [], create: [], destroy: ['a', 'b'] },
        { name: 'both empty', prev: [], next: [], create: [], destroy: [] },
    ])('plans $name', ({ prev, next, create, destroy }) => {
        const plan = planRows(prev, next);
        expect([...plan.create].sort()).toEqual([...create].sort());
        expect([...plan.destroy].sort()).toEqual([...destroy].sort());
        expect(plan.order).toEqual(next);
    });

    it('never creates or destroys a key that is in both lists', () => {
        const plan = planRows(['a', 'b', 'c'], ['c', 'x', 'a']);
        const touched = [...plan.create, ...plan.destroy];
        expect(touched).not.toContain('a');
        expect(touched).not.toContain('c');
    });
});

describe('listKeys', () => {
    it('gives the row keys of a list in order', () => {
        expect(listKeys(list(row({ key: 'p/b' }), row({ key: 'p/a' })))).toEqual(['p/b', 'p/a']);
    });

    it('gives an empty array for a list with no rows', () => {
        expect(listKeys(list())).toEqual([]);
    });

    it.each([
        ['notice', notice],
        ['loading', loading],
    ])('gives undefined for %s, so nothing is pruned', (_name, vm) => {
        expect(listKeys(vm)).toBeUndefined();
    });
});

describe('MenuState across a notice', () => {
    function render(state: MenuState, vm: ViewModel): void {
        const keys = listKeys(vm);
        if (keys !== undefined) state.reconcile(keys);
    }

    it('keeps pending and expanded rows through a notice and a following list that has them', () => {
        const state = new MenuState();
        state.begin('default/web01');
        state.toggle('default/web01');
        render(state, notice);
        render(state, loading);
        render(state, list(row()));
        expect(state.isPending('default/web01')).toBe(true);
        expect(state.isExpanded('default/web01')).toBe(true);
    });

    it('prunes them once a list no longer has the row', () => {
        const state = new MenuState();
        state.begin('default/web01');
        state.toggle('default/web01');
        render(state, notice);
        render(state, list(row({ key: 'default/other' })));
        expect(state.isPending('default/web01')).toBe(false);
        expect(state.isExpanded('default/web01')).toBe(false);
    });
});

describe('orderRows', () => {
    it.each([
        {
            name: 'keeps the shown order while the menu is open',
            prev: ['a', 'b', 'c'],
            sorted: ['c', 'a', 'b'],
            open: true,
            expected: ['a', 'b', 'c'],
        },
        {
            name: 'applies the sorted order when the menu is closed',
            prev: ['a', 'b', 'c'],
            sorted: ['c', 'a', 'b'],
            open: false,
            expected: ['c', 'a', 'b'],
        },
        {
            name: 'puts a new row after the shown ones while open',
            prev: ['a', 'b'],
            sorted: ['n', 'a', 'b'],
            open: true,
            expected: ['a', 'b', 'n'],
        },
        {
            name: 'sorts several new rows among themselves after the shown ones',
            prev: ['a', 'b'],
            sorted: ['n2', 'a', 'n1', 'b'],
            open: true,
            expected: ['a', 'b', 'n2', 'n1'],
        },
        {
            name: 'drops a vanished row and keeps the others in place',
            prev: ['a', 'b', 'c'],
            sorted: ['c', 'a'],
            open: true,
            expected: ['a', 'c'],
        },
        {
            name: 'handles removal, reorder and insertion together',
            prev: ['a', 'b', 'c'],
            sorted: ['n', 'c', 'b'],
            open: true,
            expected: ['b', 'c', 'n'],
        },
        {
            name: 'lists every row when nothing was shown yet',
            prev: [],
            sorted: ['b', 'a'],
            open: true,
            expected: ['b', 'a'],
        },
        { name: 'empties when all rows vanish', prev: ['a'], sorted: [], open: true, expected: [] },
        { name: 'is empty for no rows', prev: [], sorted: [], open: false, expected: [] },
    ])('$name', ({ prev, sorted, open, expected }) => {
        expect(orderRows(prev, sorted, open)).toEqual(expected);
    });

    it('does not modify its inputs', () => {
        const prev = ['a', 'b'];
        const sorted = ['b', 'a'];
        orderRows(prev, sorted, true);
        expect([prev, sorted]).toEqual([
            ['a', 'b'],
            ['b', 'a'],
        ]);
    });
});
