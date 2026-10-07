// SPDX-License-Identifier: GPL-2.0-or-later
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import type { InstanceAction } from '../core/incus/actions.js';
import { userMessage } from '../core/incus/validate.js';
import {
    listKeys,
    menuToRender,
    MenuState,
    orderRows,
    planRows,
    rowIsInert,
} from '../core/menu-state.js';
import type { MenuText } from '../core/menu-text.js';
import type { Row, TerminalTarget, ViewModel } from '../core/presenter.js';

import { Footer } from './footer.js';
import { InstanceItem } from './instance-item.js';
import { StateItem } from './state-item.js';

export interface IndicatorDeps {
    readonly text: MenuText;
    formatCount(value: number): string;
    onOpenChanged(open: boolean): void;
    /** Resolves once the action settled, whatever the outcome. */
    perform(action: InstanceAction, key: string): Promise<void>;
    openTerminal(target: TerminalTarget, key: string): void;
    refresh(): void;
    openPreferences(): void;
}

interface Shown {
    readonly vm: ViewModel;
    readonly showRunningCount: boolean;
}

/** The panel button and its menu. The composition root feeds it view models. */
export class Indicator {
    readonly actor = new PanelMenu.Button(0.5, _('Incus Monitor'), false);
    readonly #deps: IndicatorDeps;
    readonly #state = new MenuState();
    readonly #icon = new St.Icon({ style_class: 'system-status-icon' });
    readonly #count = new St.Label({ y_align: Clutter.ActorAlign.CENTER });
    readonly #summary = new PopupMenu.PopupBaseMenuItem({
        reactive: false,
        can_focus: false,
    });
    readonly #summaryLabel = new St.Label({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'incus-monitor-notice',
    });
    readonly #body = new PopupMenu.PopupMenuSection();
    readonly #items = new Map<string, InstanceItem>();
    #notice: StateItem | undefined;
    #shown: Shown | undefined;
    #order: readonly string[] = [];
    #menuOpen = false;
    #warned = false;
    #destroyed = false;

    constructor(deps: IndicatorDeps) {
        this.#deps = deps;
        const box = new St.BoxLayout();
        box.add_child(this.#icon);
        box.add_child(this.#count);
        this.actor.add_child(box);

        const menu = this.actor.menu;
        if (!(menu instanceof PopupMenu.PopupMenu)) throw new Error('the panel button has no menu');
        const footer = new Footer(
            deps.text.buttons,
            () => {
                deps.refresh();
            },
            () => {
                menu.close();
                deps.openPreferences();
            },
        );
        // The sentence must stay whole: long translations wrap instead of being cut off.
        this.#summaryLabel.clutter_text.line_wrap = true;
        this.#summaryLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this.#summary.visible = false;
        this.#summary.add_child(this.#summaryLabel);
        menu.addMenuItem(this.#summary);
        menu.addMenuItem(this.#body);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addMenuItem(footer.item);
        menu.connect('open-state-changed', (_menu: unknown, open: boolean) => {
            if (this.#destroyed) return;
            this.#menuOpen = open;
            // Closing applies the full sort that was held back while the menu was open.
            if (!open && this.#shown !== undefined) this.#draw(this.#shown);
            deps.onOpenChanged(open);
        });
    }

    render(vm: ViewModel, showRunningCount: boolean): void {
        if (this.#destroyed) return;
        this.#shown = { vm: menuToRender(this.#shown?.vm, vm), showRunningCount };
        this.#draw(this.#shown);
    }

    destroy(): void {
        this.#destroyed = true;
        this.#items.clear();
        this.actor.destroy();
    }

    #draw({ vm, showRunningCount }: Shown): void {
        this.#icon.icon_name = vm.panelIcon;
        this.actor.accessible_name = vm.panelAccessibleName;
        const running = vm.kind === 'list' ? vm.runningCount : 0;
        this.#count.visible = showRunningCount && running > 0;
        this.#count.text = this.#deps.formatCount(running);
        // A notice or loading view says nothing about rows, so it must not forget their state.
        const keys = listKeys(vm);
        if (keys !== undefined) this.#state.reconcile(keys);
        this.#drawSummary(vm.kind === 'list' ? vm.summary : null);
        switch (vm.kind) {
            case 'list':
                this.#dropNotice();
                this.#drawRows(vm.rows);
                break;
            case 'notice':
                this.#drawRows([]);
                this.#drawNotice(vm.text, vm.action === 'retry');
                break;
            case 'loading':
                this.#dropNotice();
                this.#drawRows([]);
                break;
        }
    }

    #drawSummary(summary: string | null): void {
        this.#summary.visible = summary !== null;
        if (summary !== null && this.#summaryLabel.text !== summary) {
            this.#summaryLabel.text = summary;
        }
    }

    /** One item per row key: removed rows go, new ones are built, the rest are updated in place. */
    #drawRows(rows: readonly Row[]): void {
        const plan = planRows(
            [...this.#items.keys()],
            orderRows(
                this.#order,
                rows.map(r => r.key),
                this.#menuOpen,
            ),
        );
        this.#order = plan.order;
        for (const key of plan.destroy) {
            this.#items.get(key)?.destroy();
            this.#items.delete(key);
        }
        for (const row of rows) {
            const inert = rowIsInert(row, this.#state);
            const known = this.#items.get(row.key);
            if (known !== undefined) {
                known.update(row, inert);
                continue;
            }
            const item = this.#createItem(row, inert);
            this.#items.set(row.key, item);
            this.#body.addMenuItem(item.item);
            item.restoreExpansion();
        }
        this.#reorder(plan.order);
    }

    #createItem(row: Row, inert: boolean): InstanceItem {
        return new InstanceItem(row, inert, {
            home: this.actor.menu.actor,
            text: this.#deps.text,
            state: this.#state,
            perform: (action, key) => {
                this.#perform(action, key);
            },
            openTerminal: (target, key) => {
                this.#deps.openTerminal(target, key);
            },
        });
    }

    // The section's children are [item, its submenu, next item, ...]. moveMenuItem moves only the
    // item actor and would split that pair, so the box is reordered directly.
    #reorder(order: readonly string[]): void {
        const box = this.#body.box;
        const actual = box.get_children();
        const wanted = order.flatMap(key => {
            const item = this.#items.get(key);
            return item === undefined ? [] : [item.item, item.item.menu.actor];
        });
        if (actual.length === wanted.length && actual.every((child, i) => child === wanted[i])) {
            return;
        }
        let previous: Clutter.Actor | null = null;
        for (const child of wanted) {
            box.set_child_above_sibling(child, previous);
            previous = child;
        }
    }

    #drawNotice(text: string, canRetry: boolean): void {
        this.#notice ??= new StateItem(this.#deps.text.buttons.retry, () => {
            this.#deps.refresh();
        });
        if (this.#notice.item.get_parent() === null) this.#body.addMenuItem(this.#notice.item);
        this.#notice.update(text, canRetry);
    }

    #dropNotice(): void {
        this.#notice?.destroy();
        this.#notice = undefined;
    }

    #perform(action: InstanceAction, key: string): void {
        this.#state.begin(key);
        this.#redraw();
        void this.#deps
            .perform(action, key)
            .catch((error: unknown) => {
                if (this.#warned) return;
                this.#warned = true;
                console.warn(
                    userMessage(`Incus Monitor: an action failed unexpectedly: ${String(error)}`),
                );
            })
            .finally(() => {
                if (this.#destroyed) return;
                this.#state.settle(key);
                this.#redraw();
            });
    }

    #redraw(): void {
        if (this.#shown !== undefined) this.#draw(this.#shown);
    }
}
