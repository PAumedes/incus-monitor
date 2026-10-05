---
name: gnome-shell-extension
description: GNOME Shell 46-50 extension know-how for this repo - ESM imports, Extension lifecycle, PopupMenu/St patterns, GSettings, gettext, prefs with libadwaita, nested-shell testing, EGO rules, version differences. Use when writing or reviewing src/ui, src/adapters, src/extension.ts, src/prefs.ts or data/.
---

# GNOME Shell extension (46–50)

## Imports (TypeScript source → emitted ESM)

```ts
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

// prefs.ts only:
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import {
  ExtensionPreferences,
  gettext as _,
} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
```

Note the capital `S`/`E` in the prefs resource path.

## Lifecycle skeleton

```ts
export default class IncusMonitorExtension extends Extension {
  #indicator: Indicator | null = null;
  #monitor: Monitor | null = null;

  override enable(): void {
    const settings = this.getSettings();
    // build adapters → core → ui; add the indicator to the panel
    Main.panel.addToStatusArea(this.uuid, this.#indicator);
  }

  override disable(): void {
    this.#monitor?.dispose(); // cancels I/O, removes sources
    this.#indicator?.destroy(); // destroys the actor tree and disconnects connectObject handlers
    this.#monitor = null;
    this.#indicator = null;
  }
}
```

## GObject subclass in TypeScript

```ts
export const Indicator = GObject.registerClass(
  { GTypeName: 'IncusMonitorIndicator' },
  class Indicator extends PanelMenu.Button {
    override _init(/* deps */): void {
      super._init(0.5, 'Incus Monitor', false);
    }
  },
);
export type Indicator = InstanceType<typeof Indicator>;
```

Shell classes such as `PanelMenu.Button` initialise in `_init`. Override `_init` as gjs.guide
does, which works on every supported version. If you want to use `constructor` instead, verify
it on GNOME 46 first and record the result in the COMPATIBILITY ledger.

## Patterns

- Signals tied to an actor: `source.connectObject('signal', handler, this)`. They are
  disconnected automatically on destroy, or explicitly with `disconnectObject(this)`.
- Menu open and close: `this.menu.connectObject('open-state-changed', (_m, open: boolean) => …, this)`.
- Text: `new St.Label({ text, y_align: Clutter.ActorAlign.CENTER })`. Never enable markup on
  daemon data.
- Icons: `new St.Icon({ icon_name: 'package-x-generic-symbolic', style_class: 'system-status-icon' })`.
- Notifications: `Main.notifyError(title, body)`.
- Clipboard: `St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text)`.
- Settings: `this.getSettings()` in the extension; `this.getSettings()` in prefs as well. Bind
  with `settings.bind(key, widget, 'prop', Gio.SettingsBindFlags.DEFAULT)` in prefs.
- Async Gio in TS: call `Gio._promisify(Gio.SocketClient.prototype, 'connect_async')` once in
  the adapter module (at import time this only patches prototypes, which is allowed static
  setup), then `await client.connect_async(addr, cancellable)`.

## Version differences that matter here

See `docs/COMPATIBILITY.md`. The essentials: 49+ removed `Clutter.ClickAction`/`TapAction` and
`Meta.Rectangle`, and nested testing uses `--devkit`; 47+ awaits `fillPreferencesWindow`, which
46 ignores. Typings are from 50: **verify every API against the 46 sources**:
`https://gitlab.gnome.org/GNOME/gnome-shell/-/blob/46.0/js/ui/<file>.js`.

## Testing in a nested shell

```sh
make install
make nested        # GNOME 49+: sudo apt install mutter-dev-bin
# inside the nested session:
gnome-extensions enable incus-monitor@patricioaumedes
journalctl -f -o cat /usr/bin/gnome-shell     # in another terminal
```

Wayland sessions cannot reload the shell in place. Use the nested shell, or log out and in.

## EGO rules that bite most often

Nothing at import or construction time, everything undone in `disable()`, no GTK in the shell,
no Shell libraries in prefs, no sync spawn or I/O, no `console.log`, readable non-minified JS, no
`version` in metadata, schemas under `org.gnome.shell.extensions.*`, clipboard use declared, no
AI-looking code. The full checklist is in `docs/RELEASING.md`.
