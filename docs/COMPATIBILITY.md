# Compatibility

## Support matrix

| Ubuntu LTS | GNOME Shell | GJS  | Incus from distro                 | Incus supported via                    |
| ---------- | ----------- | ---- | --------------------------------- | -------------------------------------- |
| 24.04      | 46          | 1.80 | 0.6 (universe): **not supported** | Zabbly `stable` (6.x/7.x) or `lts-6.0` |
| 26.04      | 50          | 1.88 | 6.0.x                             | distro, or Zabbly                      |

`metadata.json` declares `46, 47, 48, 49, 50`. We test on 46 and 50 and accept bug reports for
47–49 (Fedora, Debian, Arch users), but those versions are not part of the release gate.

Ubuntu 22.04 (GNOME 42) is **out of scope**: it predates ES-module extensions. See
[ADR-0001](adr/0001-gnome-46-to-50-esm-only.md).

| Incus series | Status                                   | Notes                                   |
| ------------ | ---------------------------------------- | --------------------------------------- |
| 6.0 LTS      | Supported                                | Fixtures: `tests/fixtures/incus/6.0/`   |
| 6.x feature  | Best effort                              | Same API surface as 6.0 plus extensions |
| 7.0 LTS      | Supported                                | Fixtures to be recorded (ROADMAP T14)   |
| < 6.0        | Rejected at runtime with a clear message |                                         |

## GNOME Shell API ledger

Every Shell or GI API used in `src/` must be listed here with the oldest version verified, either
by reading the GNOME Shell 46 source or by running on 46. Reviewers reject API use that is
missing from this table.

| API                                                       | Used in      | Since               | Verified on | Notes                                                                 |
| --------------------------------------------------------- | ------------ | ------------------- | ----------- | --------------------------------------------------------------------- |
| `Extension` / `ExtensionPreferences` (ESM)                | entry points | 45                  | 50          |                                                                       |
| `PanelMenu.Button`                                        | ui/indicator | ≤42                 | —           |                                                                       |
| `PopupMenu.PopupSubMenuMenuItem`, `PopupBaseMenuItem`     | ui/          | ≤42                 | —           |                                                                       |
| `Main.panel.addToStatusArea`                              | extension.ts | ≤42                 | —           |                                                                       |
| `Main.notifyError`                                        | ui/          | ≤42                 | —           |                                                                       |
| `Object.connectObject` / `disconnectObject`               | ui/          | 42                  | —           |                                                                       |
| `Gio.UnixSocketAddress`, `Gio.SocketClient.connect_async` | adapters/    | ≤2.60               | 50          |                                                                       |
| `Gio.Subprocess` (`Gio.SubprocessLauncher`)               | adapters/    | ≤2.60               | —           |                                                                       |
| `St.Clipboard.get_default().set_text`                     | adapters/    | ≤42                 | —           |                                                                       |
| `Adw.SpinRow`, `Adw.SwitchRow`, `Adw.EntryRow`            | prefs.ts     | Adw 1.4 / 1.4 / 1.2 | —           | GNOME 46 ships libadwaita 1.5                                         |
| `fillPreferencesWindow()` returning a Promise             | prefs.ts     | 47 awaited          | —           | On 46 the promise is ignored: build synchronously before any `await`. |

## Known version differences

| Area                  | 46–48                  | 49–50                                                                            |
| --------------------- | ---------------------- | -------------------------------------------------------------------------------- |
| Nested testing        | `gnome-shell --nested` | `gnome-shell --devkit` (needs mutter dev kit)                                    |
| `Clutter.ClickAction` | available              | **removed**: use `Clutter.ClickGesture` or button signals. We don't need either. |
| `Meta.Rectangle`      | available              | **removed**: use `Mtk.Rectangle`. Not needed.                                    |
| Adwaita icon set      | 46 theme               | 50 theme: verify with `check:icons` on both                                      |

Sources: [gjs.guide porting guides](https://gjs.guide/extensions/upgrading/gnome-shell-50.html)
for 46 → 50.
