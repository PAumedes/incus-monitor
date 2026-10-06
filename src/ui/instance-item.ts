// SPDX-License-Identifier: GPL-2.0-or-later
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import { DASH } from '../core/format.js';
import type { InstanceAction } from '../core/incus/actions.js';
import { structurallyEqual, type MenuState } from '../core/menu-state.js';
import { spokenRate, spokenValue, workingName, type MenuText } from '../core/menu-text.js';
import type { Row, RowAction, TerminalTarget } from '../core/presenter.js';

import { copyToClipboard } from './clipboard.js';

export interface InstanceItemDeps {
    readonly text: MenuText;
    readonly state: MenuState;
    perform(action: InstanceAction, key: string): void;
    openTerminal(target: TerminalTarget, key: string): void;
}

const PULSE_MS = 500;
const PULSE_DIM_OPACITY = 90;
const DIM_TEXT_OPACITY = 200;
const FULL_OPACITY = 255;

function label(styleClass?: string): St.Label {
    return new St.Label({
        y_align: Clutter.ActorAlign.CENTER,
        ...(styleClass === undefined ? {} : { style_class: styleClass }),
    });
}

// Opacity is applied to the theme's own text colour, so it follows light and dark styles. It must
// not be stacked on an insensitive label: the theme's grey times the opacity falls under 4.5:1.
function dimLabel(styleClass: string): St.Label {
    const dimmed = label(styleClass);
    dimmed.opacity = DIM_TEXT_OPACITY;
    return dimmed;
}

// `reactive: false` would make the theme draw the row insensitive (about 2:1 on light). The row
// stays reactive but inert: it neither activates, highlights on hover nor takes focus.
function inertItem(): PopupMenu.PopupBaseMenuItem {
    return new PopupMenu.PopupBaseMenuItem({ activate: false, hover: false, can_focus: false });
}

// The themes inset a rule inside a submenu on the right only, which would leave it shorter than
// the footer's. The class lets the stylesheet give it the same width.
function rule(): PopupMenu.PopupSeparatorMenuItem {
    const separator = new PopupMenu.PopupSeparatorMenuItem();
    separator.add_style_class_name('incus-monitor-rule');
    return separator;
}

/** A fixed-width cell with its text on the right, so values do not shift the columns. */
function cell(text: St.Label, styleClass: string): St.BoxLayout {
    text.x_expand = true;
    text.x_align = Clutter.ActorAlign.END;
    const box = new St.BoxLayout({ style_class: styleClass });
    box.add_child(text);
    return box;
}

function setSpoken(actor: St.Label, text: string): void {
    actor.text = text;
    actor.accessible_name = spokenValue(text, _);
}

/** One instance: a collapsed row with the readout, expanding into details and actions. */
export class InstanceItem {
    readonly item = new PopupMenu.PopupSubMenuMenuItem('');
    readonly #deps: InstanceItemDeps;
    readonly #dot = new St.Widget({ y_align: Clutter.ActorAlign.CENTER });
    readonly #project = dimLabel('incus-monitor-dim');
    readonly #typeIcon = new St.Icon({ style_class: 'popup-menu-icon' });
    readonly #cpu = label('incus-monitor-tabular');
    readonly #cpuCell = cell(this.#cpu, 'incus-monitor-cpu');
    readonly #second = label('incus-monitor-tabular');
    readonly #secondCell = cell(this.#second, 'incus-monitor-memory');
    readonly #detailItems: PopupMenu.PopupBaseMenuItem[] = [];
    readonly #memory = label('incus-monitor-tabular');
    readonly #down = label('incus-monitor-tabular incus-monitor-rate');
    readonly #up = label('incus-monitor-tabular');
    readonly #address = label('incus-monitor-tabular incus-monitor-address');
    readonly #copy: St.Button;
    readonly #uptime = label('incus-monitor-tabular');
    readonly #separator = rule();
    readonly #terminal: PopupMenu.PopupMenuItem;
    readonly #buttonsSeparator = rule();
    readonly #actionsItem = inertItem();
    readonly #actionsBox = new St.BoxLayout({
        x_expand: true,
        style_class: 'incus-monitor-actions',
    });
    #actionButtons: St.Button[] = [];
    #terminalTarget: TerminalTarget | null = null;
    #row: Row | undefined;
    #inert = false;
    #animating = false;
    #destroyed = false;

    constructor(row: Row, inert: boolean, deps: InstanceItemDeps) {
        this.#deps = deps;
        this.#copy = new St.Button({
            child: new St.Icon({ icon_name: 'edit-copy-symbolic', style_class: 'popup-menu-icon' }),
            style_class: 'button',
            can_focus: true,
        });
        this.#terminal = new PopupMenu.PopupMenuItem('');
        this.#terminal.add_style_class_name('incus-monitor-terminal');
        this.#buildHeader();
        this.#buildDetails();
        this.#buildActions();
        this.#dot.connect('notify::mapped', () => {
            if (!this.#destroyed) this.#syncPulse();
        });
        this.#trackExpansion(row.key);
        this.update(row, inert);
    }

    update(row: Row, inert: boolean): void {
        const previous = this.#row;
        if (previous !== undefined && this.#inert === inert && structurallyEqual(previous, row)) {
            return;
        }
        this.#row = row;
        this.#inert = inert;
        this.#updateHeader(row);
        this.#updateDetails(row);
        if (previous === undefined || !structurallyEqual(previous.actions, row.actions)) {
            this.#updateActions(row);
        }
        // Set apart the actions from the details, and never leave a rule with nothing under it.
        this.#separator.visible = row.details !== null && row.actions.length > 0;
        this.#buttonsSeparator.visible =
            row.actions.some(a => a.kind === 'terminal') &&
            row.actions.some(a => a.kind === 'lifecycle');
        for (const button of this.#actionButtons) {
            button.reactive = !inert;
            // A non-reactive button can still be activated from the keyboard while focused.
            button.can_focus = !inert;
        }
        this.#terminal.setSensitive(!inert);
        this.#syncPulse();
    }

    /** Call once the item is in its menu: a rebuilt row opens again if the user had it expanded. */
    restoreExpansion(): void {
        const key = this.#row?.key;
        if (key !== undefined && this.#deps.state.isExpanded(key)) this.item.menu.open();
    }

    destroy(): void {
        this.#destroyed = true;
        this.item.destroy();
    }

    #buildHeader(): void {
        const { item } = this;
        item.label.style_class = 'incus-monitor-name';
        item.insert_child_below(this.#dot, item.label);
        item.insert_child_above(this.#project, item.label);
        item.insert_child_above(this.#typeIcon, this.#project);
        // The last child is the submenu arrow, so the readout sits right before it.
        item.insert_child_at_index(this.#secondCell, item.get_n_children() - 1);
        item.insert_child_below(this.#cpuCell, this.#secondCell);
    }

    #detailRow(heading: string, ...values: St.Widget[]): void {
        const row = inertItem();
        const headingLabel = dimLabel('incus-monitor-heading');
        headingLabel.text = heading;
        row.add_child(headingLabel);
        for (const value of values) row.add_child(value);
        this.#detailItems.push(row);
        this.item.menu.addMenuItem(row);
    }

    #buildDetails(): void {
        const { headings } = this.#deps.text;
        this.#detailRow(headings.memory, this.#memory);
        const network = new St.BoxLayout();
        network.add_child(this.#down);
        network.add_child(this.#up);
        this.#detailRow(headings.network, network);
        this.#copy.connect('clicked', () => {
            const address = this.#row?.details?.address;
            if (address !== undefined && address !== DASH) copyToClipboard(address);
        });
        const address = new St.BoxLayout();
        address.add_child(this.#address);
        address.add_child(this.#copy);
        this.#detailRow(headings.address, address);
        this.#detailRow(headings.uptime, this.#uptime);
    }

    #buildActions(): void {
        this.item.menu.addMenuItem(this.#separator);
        this.#terminal.connect('activate', () => {
            const row = this.#row;
            if (this.#terminalTarget !== null && row !== undefined) {
                this.#deps.openTerminal(this.#terminalTarget, row.key);
            }
        });
        this.item.menu.addMenuItem(this.#terminal);
        this.item.menu.addMenuItem(this.#buttonsSeparator);
        this.#actionsItem.add_child(this.#actionsBox);
        this.item.menu.addMenuItem(this.#actionsItem);
    }

    #updateHeader(row: Row): void {
        const { item } = this;
        item.accessible_name = this.#inert
            ? workingName(row.accessibleName, _)
            : row.accessibleName;
        item.label.text = row.name;
        this.#project.visible = row.project !== null;
        this.#project.text = row.project ?? '';
        this.#typeIcon.icon_name = row.typeIcon;
        this.#dot.style_class = `incus-monitor-dot incus-monitor-dot-${row.dot}`;
        this.#cpuCell.visible = row.readout !== null;
        if (row.readout === null) {
            // Frozen and stopped rows show their state where the readout would be.
            this.#second.text = row.statusText;
            return;
        }
        setSpoken(this.#cpu, row.readout.cpu);
        setSpoken(this.#second, row.readout.memory);
    }

    #updateDetails(row: Row): void {
        const { details } = row;
        for (const entry of this.#detailItems) entry.visible = details !== null;
        if (details === null) return;
        setSpoken(this.#memory, details.memory);
        // The arrows are glyphs; the spoken text comes from the translated template.
        this.#down.text = `↓ ${details.network.down}`;
        this.#down.accessible_name = spokenRate('down', details.network.down, _);
        this.#up.text = `↑ ${details.network.up}`;
        this.#up.accessible_name = spokenRate('up', details.network.up, _);
        setSpoken(this.#address, details.address);
        this.#copy.visible = details.address !== DASH;
        this.#copy.accessible_name = this.#deps.text.copyAddress(details.address);
        setSpoken(this.#uptime, details.uptime);
    }

    #updateActions(row: Row): void {
        const focused = global.stage.key_focus;
        const hadFocus = this.#actionButtons.some(button => button === focused);
        for (const button of this.#actionButtons) button.destroy();
        this.#actionButtons = [];
        const terminal = row.actions.find(a => a.kind === 'terminal');
        this.#terminalTarget = terminal?.target ?? null;
        this.#terminal.visible = terminal !== undefined;
        if (terminal !== undefined) this.#terminal.label.text = terminal.label;
        const lifecycle = row.actions.filter(a => a.kind === 'lifecycle');
        this.#actionsItem.visible = lifecycle.length > 0;
        for (const action of lifecycle) this.#addActionButton(action, row.key);
        // The focused button is gone: keep the keyboard user's place instead of dropping it.
        if (hadFocus) (this.#actionButtons.find(b => b.can_focus) ?? this.item).grab_key_focus();
    }

    #addActionButton(action: Extract<RowAction, { kind: 'lifecycle' }>, key: string): void {
        const content = new St.BoxLayout({ style_class: 'incus-monitor-action' });
        content.add_child(new St.Icon({ icon_name: action.icon, style_class: 'popup-menu-icon' }));
        const text = label();
        text.text = action.label;
        content.add_child(text);
        const button = new St.Button({
            child: content,
            style_class: 'button',
            accessible_name: action.label,
            can_focus: !this.#inert,
        });
        button.connect('clicked', () => {
            if (this.#inert) return;
            this.#deps.perform(action.action, key);
        });
        this.#actionButtons.push(button);
        this.#actionsBox.add_child(button);
    }

    #trackExpansion(key: string): void {
        const { state } = this.#deps;
        this.item.menu.connect('open-state-changed', (_menu: unknown, open: boolean) => {
            if (!this.#destroyed && open !== state.isExpanded(key)) state.toggle(key);
        });
    }

    // One looping transition, only while the dot is on screen: a loop held while the menu is
    // closed would keep the compositor busy. Otherwise, and with animations off, the dot is
    // dimmed still.
    #syncPulse(): void {
        const dot = this.#dot;
        const animate = this.#inert && dot.mapped && St.Settings.get().enable_animations;
        if (animate !== this.#animating) {
            this.#animating = animate;
            dot.remove_all_transitions();
            if (animate) {
                dot.opacity = FULL_OPACITY;
                dot.ease({
                    opacity: PULSE_DIM_OPACITY,
                    duration: PULSE_MS,
                    mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                    repeatCount: -1,
                    autoReverse: true,
                });
            }
        }
        if (!animate) dot.opacity = this.#inert ? PULSE_DIM_OPACITY : FULL_OPACITY;
    }
}
