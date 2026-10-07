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

Above the rows, when Incus returns two or more instances, one inert line reads "2 of 5 running". The total counts every
instance, including the stopped ones hidden by the show-stopped setting; the number is the panel's. It is not
focusable, has no icon, reuses the notice label style, and is hidden for a single instance, a notice and the
first load. Its text is assigned only when it changes.

Expanded row (`PopupSubMenuMenuItem`):

```text
│ ● web01                                     ⌄│
│     Memory     220 MB of 2 GB                │
│     Disk       50 MB of 1 GB                 │
│     Network    ↓ 12 kB/s  ↑ 1 kB/s           │
│     Address    10.0.3.15                  ⧉  │
│     Uptime     3 h 12 min                    │
│     Forwards   tcp 18080 → 80, udp 5353 → 53 │
│     ──────────────────────────────────────── │
│     Open Shell                               │
│     ──────────────────────────────────────── │
│     [■ Stop]   [↻ Restart]   [⏸ Freeze]       │
```

- The Disk row is omitted when the pool reports no usage (`dir`); it reads "X of Y" with a quota
  and "X" without; without a quota it shows the instance's root-volume usage, not pool capacity.
  It is an inert item like the others, so hiding it cannot move key focus.
- The Forwards row lists the instance's `proxy` devices as `protocol listen → target`, ports or
  `first-last` ranges without separators, in device-key order, at most three and then "+N more".
  It shows ports only: the listen host is not shown, so loopback versus all interfaces is not
  visible. Only host-bound forwards are listed (`bind=instance` is skipped), comma-separated port
  lists are unsupported and skipped, and at most 64 devices are read. Unix-socket and other
  non-tcp/udp proxies are left out. The value wraps instead of being cut, and has a spoken form
  ("TCP port 18080 forwarded to 80") as its accessible name. It is configuration, so it shows for
  a stopped instance too, and is hidden when there are none. It is an inert item like the others.
- The rule above the actions shows when either the details or the Forwards row is shown, and an
  action exists.
- A `PopupSeparatorMenuItem` sets the actions (Open Shell and the buttons) apart from the
  details. It is shown only when the details (or the Forwards row) and at least one action are, and is destroyed with
  the row. A second one sets the buttons apart from Open Shell, shown only when both are. The
  address has an 8 px right margin so the copy button does not touch it.
- **Rules and Open Shell inside the block.** Yaru and the stock theme inset a submenu rule on one
  side only (2.5 em), so it ended short of the footer's rule: our rules take the class
  `incus-monitor-rule`, which zeroes that margin. At rest Open Shell is a plain row on the detail
  rows' text column. The theme draws a submenu item's hover and keyboard focus edge to edge with
  square corners, which looks like a stray grey bar (it is easy to hit: after Open Shell is
  clicked, the expanded row reopens under a pointer that is still there), so the row's class
  `incus-monitor-terminal` insets that highlight 6 px with a rounded corner, and the padding keeps
  the text where it was. Stock items take key focus on hover and keep it when the pointer leaves,
  which left Open Shell (or the header) highlighted over an inert detail row, so on pointer exit
  the item hands key focus to the top-level menu actor; a keyboard-focused item the pointer never
  entered is untouched. It must not be the submenu's own actor: GNOME 46's menu hands key focus to
  an item that turns sensitive again while its menu actor holds it, so Open Shell was highlighted
  as soon as an action settled under a resting pointer. While a row is pending its buttons stop taking focus, and a focused button would
  lose key focus to whichever neighbour the Shell version picks (Open Shell on GNOME 46), so the row
  moves it to its header first and returns it to the same action once the row settles, unless the
  user moved it meanwhile. The copy button keeps its space (transparent and inert) when there is no address, so the details
  block has the same height in every state and nothing moves under a resting pointer. Expansion
  never moves key focus; Tab reaches the copy button, Open Shell
  and the action buttons in turn. The header's grey while expanded is the theme's `:checked` state
  and stays.
- **Panel**: the expanded block (details, Open Shell, actions) sits on one faint translucent grey
  panel with rounded bottom corners and a 4 px bottom margin, so it reads as one group and the next
  header is clearly apart. It replaces, rather than stacks on, the tint Yaru paints on GNOME 50.
- **Rows** are sorted running → frozen → stopped, then by name (locale-aware collation). While the
  menu is open, rows keep their position and new rows are appended, so a state change never moves a
  row under the pointer; closing the menu applies the full order. The
  project name is shown in dim text only when instances come from more than one project.
- **Status dot**: an 8 px circle styled by CSS class (`running`, `frozen`, `stopped`, `error`). The
  row's accessible name always includes the state in words.
- A `busy` instance uses the `frozen` dot and an `unknown` one the `stopped` dot; the status word
  carries the difference.
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

  A frozen instance offers Unfreeze and Stop; whether Incus stops a frozen instance gracefully is
  unverified (see [INCUS_API.md](INCUS_API.md#quirks)).

  "Open Shell" becomes "Open Console" for VMs without a running agent.

- **Pending action**: the row's action buttons become insensitive and the dot pulses once per
  second via CSS transition. No spinners in the panel. Pending is a set of row keys, set before
  the action runs and cleared when it settles whatever the outcome, and pruned of rows that
  disappeared; several rows can be pending at once. A row the daemon reports as transitional
  (`busy`) looks the same.
- **Expansion**: which rows are expanded is remembered per row key and survives re-renders.
- **Accessibility text**: a missing detail value ("—") is announced as a translated "Not
  available", and spoken download and upload text comes from a translated template. The
  instance type is shown by its icon only; the row's accessible name leaves it out.
- **Failures** raise a single notification with the Incus message. Nothing modal. When the daemon answered with an error or timed out, it carries one "Show log" button that opens the instance's log in the terminal, and it stays in the message tray while it has the button. It is cleared when the next action on the same instance succeeds.
- **Unexpected stops** raise one transient notification, without a button, titled "Instance not running" ("N instances not running" for several), when a running instance becomes `stopped` or `error` and no menu action on it is in flight. Several in one poll share one notification (three names, then "+N more"). It never replaces a failure notification, and the menu is unchanged. Both notifications come from "Incus Monitor" with the panel icon.
- **No destructive actions** (delete, rebuild, snapshot restore) in the menu. Ever.

## Empty and error states

One row, one sentence, at most one action. While loading, the previous menu stays if one was
already rendered:

| Condition                        | Text                                                  | Action |
| -------------------------------- | ----------------------------------------------------- | ------ |
| No socket found                  | Incus is not installed                                | none   |
| Socket exists, permission denied | Add your user to the "incus" group, then log in again | none   |
| Daemon not responding            | Incus is not responding                               | Retry  |
| Unsupported server               | Incus 6.0 or later is required                        | none   |
| No instances                     | No instances                                          | none   |
| All instances stopped, hidden    | No running instances                                  | none   |

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

- Inherit the Shell theme. `stylesheet.css` holds the status dot, tabular numerals, dim text, the
  details panel and its layout (spacing, the readout column widths, the inset terminal row), all with the
  `incus-monitor-` prefix. High contrast is not measured.
- **Contrast**: every text in the menu, including detail headings and values, needs at least 4.5:1
  against the menu background in light and dark styles. Detail rows are `PopupBaseMenuItem`s built
  with `{ activate: false, hover: false, can_focus: false }`: reactive, so the theme does not draw
  them insensitive (about 2:1 on light), but inert (no activation, hover highlight or focus stop).
  Never use `reactive: false` for rows that show text. Headings add an opacity of 200/255 on the
  normal text colour, which measured at least 5.5:1 (GNOME 46 Yaru light is the lowest).
- The panel is `rgba(128, 128, 128, 0.12)` on the submenu actor (`.popup-sub-menu.incus-monitor-details`).
  Measured heading contrast on it: 5.2:1 (46 light), 8.8:1 (46 dark), 7.3:1 (50 light), 6.9:1 (50 dark).
  High contrast was not measured.
- Status colours are the GNOME palette's semantic greens and yellows, and they must stay legible
  in light and dark styles and in high contrast.
- No custom fonts, no hard-coded font sizes, no fixed widths except the readout column (in `em`).

## Preferences (GTK4 + libadwaita)

One `Adw.PreferencesPage` with two groups. The first holds:

- Refresh interval (spin row, 2–60 s)
- Show running count (switch row)
- Show stopped instances (switch row)

The second holds only the Terminal row, so its one-line description sits directly above the field:

- Terminal (entry row, empty field, explained by the group description). Documented, not guessed: the command is appended as separate arguments, so the program must accept it that way (`alacritty -e`, `xterm -e`, `konsole -e`, `gnome-terminal --`, `xfce4-terminal -x`). Terminals that take one command string (`xfce4-terminal -e`, `mate-terminal -e`) are not supported.
