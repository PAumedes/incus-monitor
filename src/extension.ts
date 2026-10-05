// SPDX-License-Identifier: GPL-2.0-or-later
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

import { Indicator } from './ui/indicator.js';

export default class IncusMonitorExtension extends Extension {
    #indicator: Indicator | null = null;

    override enable(): void {
        this.#indicator = new Indicator();
        Main.panel.addToStatusArea(this.uuid, this.#indicator);
    }

    override disable(): void {
        this.#indicator?.destroy();
        this.#indicator = null;
    }
}
