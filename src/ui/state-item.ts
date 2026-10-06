// SPDX-License-Identifier: GPL-2.0-or-later
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

/** The single row shown instead of the list: one sentence and at most a Retry button. */
export class StateItem {
    readonly item = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });
    readonly #label = new St.Label({
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        style_class: 'incus-monitor-notice',
    });
    readonly #retry: St.Button;

    constructor(retryLabel: string, onRetry: () => void) {
        this.#retry = new St.Button({
            label: retryLabel,
            style_class: 'button',
            can_focus: true,
            visible: false,
        });
        // The sentence must stay whole: long translations wrap instead of being cut off.
        this.#label.clutter_text.line_wrap = true;
        this.#label.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        this.#retry.connect('clicked', onRetry);
        this.item.add_child(this.#label);
        this.item.add_child(this.#retry);
    }

    update(text: string, canRetry: boolean): void {
        this.#label.text = text;
        this.#retry.visible = canRetry;
    }

    destroy(): void {
        this.item.destroy();
    }
}
