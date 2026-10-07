// SPDX-License-Identifier: GPL-2.0-or-later
import type { Row, ViewModel } from './presenter.js';

/**
 * What the menu remembers between renders, keyed by `Row.key`: rows with an action in flight and
 * rows the user expanded.
 */
export class MenuState {
    readonly #pending = new Set<string>();
    readonly #expanded = new Set<string>();

    begin(key: string): void {
        this.#pending.add(key);
    }

    settle(key: string): void {
        this.#pending.delete(key);
    }

    isPending(key: string): boolean {
        return this.#pending.has(key);
    }

    toggle(key: string): void {
        if (!this.#expanded.delete(key)) this.#expanded.add(key);
    }

    isExpanded(key: string): boolean {
        return this.#expanded.has(key);
    }

    /** Forgets rows that are no longer listed, so a reused name starts clean. */
    reconcile(keys: readonly string[]): void {
        const listed = new Set(keys);
        for (const set of [this.#pending, this.#expanded]) {
            for (const key of set) if (!listed.has(key)) set.delete(key);
        }
    }
}

/** A busy row (reported by the daemon) and a pending one (asked by the user) look the same. */
export function rowIsInert(row: Row, state: MenuState): boolean {
    return row.busy || state.isPending(row.key);
}

/** While loading, the menu that is already on screen stays. */
export function menuToRender(previous: ViewModel | undefined, next: ViewModel): ViewModel {
    return next.kind === 'loading' && previous !== undefined ? previous : next;
}

/** Deep equality for the plain data of a view model, so unchanged rows are not touched. */
export function structurallyEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) || Array.isArray(b)) {
        return (
            Array.isArray(a) &&
            Array.isArray(b) &&
            a.length === b.length &&
            a.every((item: unknown, i) => structurallyEqual(item, b[i]))
        );
    }
    const left = Object.entries(a);
    const right = new Map(Object.entries(b));
    return (
        left.length === right.size &&
        left.every(([key, value]) => right.has(key) && structurallyEqual(value, right.get(key)))
    );
}

/** Row keys of a list, or undefined for a notice or loading: those must not prune the state. */
export function listKeys(vm: ViewModel): readonly string[] | undefined {
    return vm.kind === 'list' ? vm.rows.map(r => r.key) : undefined;
}

export interface RowPlan {
    readonly create: readonly string[];
    readonly destroy: readonly string[];
}

/** Which rows to build and drop so each key keeps one item. */
export function planRows(previous: readonly string[], next: readonly string[]): RowPlan {
    const before = new Set(previous);
    const after = new Set(next);
    return {
        create: next.filter(key => !before.has(key)),
        destroy: previous.filter(key => !after.has(key)),
    };
}

/**
 * The on-screen order. While the menu is open, rows already shown keep their place and new rows
 * go last in sorted order, so a state change never moves a row under the pointer.
 */
export function orderRows(
    previous: readonly string[],
    sorted: readonly string[],
    menuOpen: boolean,
): readonly string[] {
    if (!menuOpen) return sorted;
    const listed = new Set(sorted);
    const kept = previous.filter(key => listed.has(key));
    const shown = new Set(kept);
    return [...kept, ...sorted.filter(key => !shown.has(key))];
}
