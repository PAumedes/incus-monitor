// SPDX-License-Identifier: GPL-2.0-or-later
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';

export const Indicator = GObject.registerClass(
    { GTypeName: 'IncusMonitorIndicator' },
    class Indicator extends PanelMenu.Button {
        override _init(): void {
            // The menu arrives with ROADMAP task T12.
            super._init(0.5, 'Incus Monitor', true);
            this.add_child(
                new St.Icon({
                    icon_name: 'package-x-generic-symbolic',
                    style_class: 'system-status-icon',
                }),
            );
        }
    },
);

export type Indicator = InstanceType<typeof Indicator>;
