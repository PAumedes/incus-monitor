// SPDX-License-Identifier: GPL-2.0-or-later
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class IncusMonitorPreferences extends ExtensionPreferences {
    // GNOME 46 ignores the returned promise: build the whole window before any await.
    override fillPreferencesWindow(): Promise<void> {
        // Implemented in ROADMAP task T13.
        return Promise.resolve();
    }
}
