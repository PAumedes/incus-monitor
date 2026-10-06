---
name: ui-verification
description: How to verify a UI or extension change on real GNOME Shell versions (46 and 50) and against real Incus data - which tier to run, demo instances, contrast measurement, known environment pitfalls, and the by-eye checklist handed to the maintainer. Use for any change to src/ui, data/stylesheet.css, src/extension.ts or user-visible strings, before calling it done.
---

# UI verification

Unit tests cannot see a menu. `docs/ENGINEERING.md` section 10.6 says a UI change is not done
until it was looked at on GNOME 50 and, before release, on 46. The tiers and the manual matrix are
in `docs/TESTING.md` (levels 1 to 6, `#manual-matrix`); this skill says which to pick and what
goes wrong.

## Pick the tier

| Question                                                              | Use                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the logic and the view model behave?                             | `npm test -- <file>`                                                                                                                                                                                                                                            |
| Does the extension load, stay free of errors, survive disable/enable? | `make smoke` (headless, no display). It installs first and asks the Shell over D-Bus for the extension state. GNOME 46 serves the Extensions API on bus `org.gnome.Shell`, path `/org/gnome/Shell`; 47+ on `org.gnome.Shell.Extensions`. The script tries both. |
| Does it look right with real data on GNOME 50?                        | `make demo`, `make install`, `make nested`. Nested uses its own dconf profile and copies the appearance keys (theme, accent, text scale, animations) from the real session.                                                                                     |
| Does it work on GNOME 46?                                             | `make incus-package RELEASE=24.04 && make vm RELEASE=24.04`. Log in as `ubuntu`.                                                                                                                                                                                |

- `make build` only fills `dist/`. `make install` installs the zip for the user and does not
  enable it. Only `gnome-extensions enable <uuid>` (uuid in `data/metadata.json`) enables it in the
  real session, and Wayland needs a logout and login before a newly installed extension is seen.
- A per-user install shadows a `.deb`: `make uninstall` before testing the package.
- Extension zips installed by hand need `glib-compile-schemas schemas` in the extension
  directory. `gnome-extensions install` and `make install` do it for you.

## Use realistic data

Recorded fixtures pass while the real thing breaks: a VM without an agent reports
`state.cpu.usage = -1`, and detail rows rendered faint. Before reporting a UI change as working,
look at it with `make demo` running (instances `imon-demo-*`: running, busy, stopped, frozen, a VM).

- Agents may create throwaway instances only with a recognisable prefix (`imon-demo-`, or
  `imon-scratch-`) and must ask the maintainer to remove them. `.claude/settings.json` denies
  `incus delete`, `incus stop` and `incus restart`; do not work around it. The maintainer runs
  `make demo-clean`.
- Never change the state of the maintainer's own instances.

## Accessibility: measure, do not guess

1. Screenshot the open menu in light and dark style, with rows expanded.
2. With Python PIL, take the darkest (light style) or lightest (dark style) text pixel of each
   text region and the background pixel beside it, then compute the WCAG contrast ratio
   (relative luminance of sRGB, `(L1 + 0.05) / (L2 + 0.05)`).
3. Information text needs at least 4.5:1. Report the numbers, not "looks fine".

A non-reactive `PopupBaseMenuItem` is drawn insensitive (faded). For inert rows pass
`{activate: false, hover: false, can_focus: false}` instead of `reactive: false`.

## Pitfalls seen in this project

- Debian and other non-Ubuntu containers can hang in `systemd-udev-trigger` or `systemd-networkd`
  and never get a DHCP lease. Run `dhclient` inside by hand. Ubuntu 26.04 containers need
  `security.nesting=true` (see the troubleshooting table in `docs/TESTING.md`).
- Alpine VMs need `security.secureboot=false` (the demo script already sets it).
- `kill` is refused inside the maintainer's restricted-project containers. Stop your own shells
  with a bounded pattern: SIGTERM, poll for a few seconds, then SIGKILL (see `stop_shell` in
  `scripts/smoke-shell.sh`).
- The first image download can take minutes, quietly with `-q`. Wait; do not assume a hang.
- Non-interactive `incus` calls need `</dev/null`.
- Never symlink `node_modules` into a worktree: tools resolve through it and touch the original.
  Run `npm ci` in the worktree.

## Visual harness

`make screenshots` (`scripts/ui-screenshots.sh`) boots a throwaway headless Shell, expands a row and
writes PNGs plus `<scheme>-diagnostics.txt` (focus, pseudo-classes, geometry) to `build/screenshots/`:
resting, hover on Open Shell, pointer leaving it (and the header) for a detail row, keyboard Tab. Options: `SCHEME=light|dark`, `VM=imon-desktop-2404` (runs
inside the 46 VM and pulls the PNGs back); the script takes `--rows name1,name2` and `--out DIR`.
Run it light and dark on `make demo` data, and view the PNGs with the Read tool. `--pointer` is the mouse scenario (virtual button press, pointer left still, changes logged); a
virtual press does work on 46. It does not touch your session or `~/.local`.

## Handing off to the maintainer

Automated pixels do not cover motion, focus, Orca or 200 % scaling. End the report with a short
by-eye checklist limited to what the change touches, taken from `docs/TESTING.md#manual-matrix`,
with the exact commands to reach the state (`make demo`, `make install`, `make nested`, or the VM)
and what to look at: which row, which state, light and dark. State which tiers you ran and
which you could not (for example 46 when no VM was available).
