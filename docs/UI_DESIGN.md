# UI design

> Less is more. The menu answers one question at a glance: _what is running, and is it healthy?_
> Everything else is one click away, never zero.

Inspired by [Vitals](https://github.com/corecoding/Vitals): a compact panel readout, a plain
dropdown built from stock `PopupMenu` items, symbolic icons, and a small footer of icon buttons.
Follow the [GNOME HIG](https://developer.gnome.org/hig/) for wording and capitalisation.

## Panel indicator

```text
 [▣ 3]
```

- Icon: `package-x-generic-symbolic`. The number shows running instances, and is hidden when the
  setting is off or the count is 0.
- Error states change only the icon to `dialog-warning-symbolic`. No colour, no badge animation.
- Accessible name: "Incus, 3 running".

## Menu

```text
┌──────────────────────────────────────────────┐
│ ● web01              ▣      4 %   220 MB    ›│  running container
│ ● win11-vm           🖥     12 %   3.9 GB    ›│  running VM
│ ◐ build              ▣        Frozen        ›│
│ ○ db-old             ▣        Stopped       ›│  (hidden if show-stopped is off)
├──────────────────────────────────────────────┤
│                                   ⟳     ⚙    │  footer: Refresh, Preferences
└──────────────────────────────────────────────┘
```

Expanded row (`PopupSubMenuMenuItem`):

```text
│ ● web01                                     ⌄│
│     Memory     220 MB of 2 GB                │
│     Network    ↓ 12 kB/s  ↑ 1 kB/s           │
│     Address    10.0.3.15                  ⧉  │
│     Uptime     3 h 12 min                    │
│     Open Shell                               │
│     [■ Stop]   [↻ Restart]   [⏸ Freeze]       │
```

- **Rows** are sorted running → frozen → stopped, then by name (locale-aware collation). The
  project name is shown in dim text only when instances come from more than one project.
- **Status dot**: an 8 px circle styled by CSS class (`running`, `frozen`, `stopped`, `error`). The
  row's accessible name always includes the state in words.
- **Type icon**: `package-x-generic-symbolic` for containers, `computer-symbolic` for VMs.
- **Readout**: CPU % and memory, for running instances only, in tabular numerals so the columns
  don't jitter.
- **Actions** depend on state, and only valid actions are shown:

  | State   | Actions                                    |
  | ------- | ------------------------------------------ |
  | Running | Stop, Restart, Freeze, Open Shell          |
  | Frozen  | Unfreeze, Stop                             |
  | Stopped | Start                                      |
  | Other   | none (transitional states show a busy row) |

  "Open Shell" becomes "Open Console" for VMs without a running agent.

- **Pending action**: the row's action buttons become insensitive and the dot pulses once per
  second via CSS transition. No spinners in the panel.
- **Failures** raise a single `Main.notifyError(title, incusMessage)`. Nothing modal.
- **No destructive actions** (delete, rebuild, snapshot restore) in the menu. Ever.

## Empty and error states

One row, one sentence, at most one action:

| Condition                        | Text                                                  | Action |
| -------------------------------- | ----------------------------------------------------- | ------ |
| No socket found                  | Incus is not installed                                | none   |
| Socket exists, permission denied | Add your user to the "incus" group, then log in again | none   |
| Daemon not responding            | Incus is not responding                               | Retry  |
| Unsupported server               | Incus 6.0 or later is required                        | none   |
| No instances                     | No instances                                          | none   |

## Icons

Only stock **Adwaita symbolic** icons ([ADR-0006](adr/0006-adwaita-icons-only.md)), never from
the `legacy/` context. `scripts/check-icons.sh` (part of `make check`) verifies them against the installed theme, and CI
runs that check on Ubuntu 24.04 and 26.04 images.

| Use              | Icon name                       |
| ---------------- | ------------------------------- |
| Panel, container | `package-x-generic-symbolic`    |
| Virtual machine  | `computer-symbolic`             |
| Start / Unfreeze | `media-playback-start-symbolic` |
| Stop             | `media-playback-stop-symbolic`  |
| Freeze           | `media-playback-pause-symbolic` |
| Restart          | `system-reboot-symbolic`        |
| Copy address     | `edit-copy-symbolic`            |
| Refresh          | `view-refresh-symbolic`         |
| Preferences      | `preferences-system-symbolic`   |
| Error            | `dialog-warning-symbolic`       |

"Open Shell" is a text item: Adwaita has no non-legacy terminal icon.

## Styling

- Inherit the Shell theme. `stylesheet.css` holds only the status dot, tabular numerals and dim
  text, all with the `incus-monitor-` prefix.
- Status colours are the GNOME palette's semantic greens and yellows, and they must stay legible
  in light and dark styles and in high contrast.
- No custom fonts, no hard-coded font sizes, no fixed widths except the readout column (in `em`).

## Preferences (GTK4 + libadwaita)

One `Adw.PreferencesPage` with one group:

- Refresh interval (spin row, 2–60 s)
- Show running count (switch row)
- Show stopped instances (switch row)
- Terminal (entry row, placeholder "Automatic")
