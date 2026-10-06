// SPDX-License-Identifier: GPL-2.0-or-later
import Clutter from 'gi://Clutter';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import type { MenuText } from '../core/menu-text.js';

function iconButton(icon: string, accessibleName: string, onClick: () => void): St.Button {
    const button = new St.Button({
        child: new St.Icon({ icon_name: icon, style_class: 'popup-menu-icon' }),
        style_class: 'button',
        accessible_name: accessibleName,
        can_focus: true,
    });
    button.connect('clicked', onClick);
    return button;
}

/** Refresh and Preferences, right-aligned. */
export class Footer {
    readonly item = new PopupMenu.PopupBaseMenuItem({ reactive: false, can_focus: false });

    constructor(buttons: MenuText['buttons'], onRefresh: () => void, onPreferences: () => void) {
        const box = new St.BoxLayout({
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
            style_class: 'incus-monitor-footer',
        });
        box.add_child(iconButton('view-refresh-symbolic', buttons.refresh, onRefresh));
        box.add_child(
            iconButton('preferences-system-symbolic', buttons.preferences, onPreferences),
        );
        this.item.add_child(box);
    }
}
