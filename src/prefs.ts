// SPDX-License-Identifier: GPL-2.0-or-later
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {
    ExtensionPreferences,
    gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import { formatTerminalCommand, parseTerminalCommand } from './core/terminal-command.js';

const REFRESH_MIN_SECONDS = 2;
const REFRESH_MAX_SECONDS = 60;

export default class IncusMonitorPreferences extends ExtensionPreferences {
    // PreferencesWindow is the host window on GNOME 46-50: deprecated since libadwaita 1.6, not
    // removed. GNOME 46 ignores the returned promise and 47+ awaits it, so everything is built
    // before returning.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    override fillPreferencesWindow(window: Adw.PreferencesWindow): Promise<void> {
        const settings = this.getSettings();

        const refresh = new Adw.SpinRow({
            // Translators: label of the setting for seconds between refreshes while the menu is closed.
            title: _('Refresh interval'),
            // Translators: unit hint for the refresh interval row.
            subtitle: _('Seconds between updates while the menu is closed'),
            adjustment: new Gtk.Adjustment({
                lower: REFRESH_MIN_SECONDS,
                upper: REFRESH_MAX_SECONDS,
                step_increment: 1,
                page_increment: 10,
            }),
        });
        settings.bind('refresh-interval', refresh, 'value', Gio.SettingsBindFlags.DEFAULT);

        const runningCount = new Adw.SwitchRow({
            // Translators: label of a switch; the count is shown next to the panel icon.
            title: _('Show running count'),
        });
        settings.bind('show-running-count', runningCount, 'active', Gio.SettingsBindFlags.DEFAULT);

        const stoppedInstances = new Adw.SwitchRow({
            // Translators: label of a switch that lists stopped instances in the menu.
            title: _('Show stopped instances'),
        });
        settings.bind(
            'show-stopped-instances',
            stoppedInstances,
            'active',
            Gio.SettingsBindFlags.DEFAULT,
        );

        const terminal = new Adw.EntryRow({
            // Translators: label of the entry for the terminal program used to open a shell.
            title: _('Terminal'),
        });
        // Not bound with Gio.Settings.bind: the key is a string array and the row holds text.
        const showStored = (): void => {
            const text = formatTerminalCommand(settings.get_strv('terminal-command'));
            // Skip equal text so an unrelated change does not move the cursor while typing.
            if (terminal.text !== text) terminal.text = text;
        };
        showStored();
        // After the initial text, which could otherwise reveal the apply button.
        terminal.show_apply_button = true;
        terminal.connect('apply', () => {
            settings.set_strv('terminal-command', [...parseTerminalCommand(terminal.text)]);
        });
        const changedId = settings.connect('changed::terminal-command', showStored);
        window.connect('close-request', () => {
            settings.disconnect(changedId);
            return false;
        });

        const group = new Adw.PreferencesGroup({
            // Translators: explains the Terminal field; leave it empty to detect a terminal.
            description: _('Program then arguments separated by spaces. Empty detects a terminal.'),
        });
        for (const row of [refresh, runningCount, stoppedInstances, terminal]) group.add(row);
        const page = new Adw.PreferencesPage();
        page.add(group);
        // eslint-disable-next-line @typescript-eslint/no-deprecated
        window.add(page);
        return Promise.resolve();
    }
}
