# Testing and TDD

## TDD cycle

All production code in `src/core/` and `src/adapters/` is written test-first.

1. **Red**: write the smallest test that expresses the next behaviour. Run it and confirm it
   fails **for the expected reason** (an assertion, not a typo or a missing import). Paste the
   failure output into the merge request or agent report.
2. **Green**: write the minimum code that passes. Hard-coding is fine if the next test will force
   the generalisation.
3. **Refactor**: with tests green, improve the design in small, named, behaviour-preserving
   steps (Fowler's _Refactoring_; see `.claude/skills/refactoring/SKILL.md`). Run the suite
   after every step.
4. Repeat. Commit at green: one behaviour per commit (`test:` + `feat:` squashed is fine).

Rules:

- A bug fix starts with a failing regression test that reproduces the bug.
- Do not change a test and the code under test in the same step. If a test is wrong, fix the test
  first (red for the right reason), then the code.
- Never weaken an assertion, raise a timeout or add a skip to make a test pass.
- Coverage thresholds (95 % lines and branches on `src/core/`) are a floor, not the goal. Every
  branch must be exercised **on purpose**.

## Test tiers

| Tier        | Location                   | Runner                            | Scope                                                               | Speed |
| ----------- | -------------------------- | --------------------------------- | ------------------------------------------------------------------- | ----- |
| Unit        | `tests/unit/`              | Vitest (Node)                     | `src/core/**`, repository invariants                                | ms    |
| Contract    | `tests/unit/contract/`     | Vitest                            | Decoders against recorded Incus fixtures (6.0, 7.0)                 | ms    |
| Integration | `tests/gjs/`               | `gjs -m` + `tests/gjs/harness.ts` | `src/adapters/**` against a fake Incus server on a temp unix socket | s     |
| Live smoke  | `tests/gjs/live/` (opt-in) | `INCUS_LIVE=1 make test-gjs`      | Read-only calls against the developer's real Incus                  | s     |
| Manual      | this document              | nested shell / VMs                | UI, lifecycle, compatibility matrix                                 | min   |

### Unit tests

- Pure functions get table-driven tests (`it.each`).
- Ports are faked with small hand-written fakes in `tests/unit/fakes/`, not with deep mocks.
  A `FakeClock` advances time explicitly; a `FakeTransport` maps request lines to canned
  responses and records every request.
- Never sleep in tests. Time is a port.
- Property-style edge cases matter in the HTTP codec: split responses at every byte boundary,
  chunk sizes in hex upper and lower case, missing `Content-Length`, truncated bodies.

### Contract tests and fixtures

`tests/fixtures/incus/<series>/` holds sanitized real responses recorded with
`scripts/record-fixtures.py` (read-only GETs, identifiers replaced with RFC 5737/3849 values).
Every decoder must accept every fixture of every supported series. When a new Incus series is
supported, record its fixtures first.

Scenario fixtures that cannot be recorded safely (VMs without an agent, frozen instances,
clustered members) are built with typed builders in `tests/unit/builders.ts`, starting from a
recorded object and changing only the fields under test.

### Integration tests (GJS)

`tests/gjs/` runs inside a real GLib main loop. The fake server is a `Gio.SocketService` bound to
a temporary unix socket. It answers scripted responses and can misbehave on purpose: stall,
close mid-body, send chunked encoding, or refuse permission. Each test cleans up its socket
and sources.

```sh
make test-gjs
```

## Testing on your machine

From fastest to most realistic:

| Level                         | Command                                                                                 | What you get                                                                                                                                 | Needs                                                |
| ----------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1. Unit (TDD loop)            | `npm run test:watch`                                                                    | Core logic, in milliseconds                                                                                                                  | Node 22 (`.nvmrc`)                                   |
| 2. Local gate                 | `make check test-gjs`                                                                   | Everything except packaging                                                                                                                  | gjs                                                  |
| 3. Clean CI run               | `make incus-ci RELEASE=24.04` (or `incus-ci-all`)                                       | The exact CI pipeline in a disposable container; artifacts in `build/incus-<release>/`                                                       | Incus (you have it)                                  |
| 4a. Headless smoke, 46 and 50 | `make smoke`                                                                            | Boots a throwaway headless Shell, checks the extension is ACTIVE with no errors and survives disable/enable cycles                           | —                                                    |
| 4b. Nested shell, GNOME 50    | `make install && make nested`                                                           | The extension in a GNOME window on your desktop, no logout                                                                                   | `sudo apt install mutter-dev-bin` (GNOME 49+ devkit) |
| 4c. Screenshots               | `make screenshots` (`SCHEME=dark`, `VM=imon-desktop-2404`)                              | PNGs of an expanded row at rest, hovered, left by the pointer and keyboard-focused, from a throwaway headless Shell, in `build/screenshots/` | `make demo` for data                                 |
| 5. Your real session          | `make install`, log out and in, `gnome-extensions enable incus-monitor@patricioaumedes` | Daily-driver test against your real Incus                                                                                                    | —                                                    |
| 6. Desktop VM, GNOME 46 or 50 | `make incus-package RELEASE=24.04 && make vm RELEASE=24.04`                             | A full Ubuntu desktop VM with Incus, a demo container and the `.deb` installed                                                               | `sudo apt install virt-viewer`                       |

Notes:

- `make nested` and `make smoke` use their own settings databases with the extension already
  enabled. Your real session's settings are never touched. Logs appear in the terminal that
  started `make nested`.
- `make screenshots` (`scripts/ui-screenshots.sh`, see its header for `--rows` and `--out`) uses a
  private data directory, dconf profile and config directory, all deleted on exit. A helper
  extension under `scripts/ui-screenshots/` drives the menu and is never packaged. With `VM=<name>`
  it runs inside that Incus desktop VM as `ubuntu` and pulls the PNGs back. Synthetic clicks were
  not delivered on GNOME 46, so there is no click scenario; check the `key focus` line of
  `<scheme>-diagnostics.txt` for hover, leave and keyboard shots (after `leave`, no item may be
  `[focus]`).
- `make demo` creates `imon-demo-*` instances (running, busy, stopped, frozen, a VM) so levels 4b and 5
  show realistic data; `make demo-clean` deletes them and only them.
- Until ROADMAP task T12, the extension shows only its panel icon (a box), with no menu.
- Wayland cannot restart the shell in place. After `make install` in your real session, log out
  and back in.
- A per-user install (`make install`) shadows a system `.deb` install. Use `make uninstall` before
  testing the `.deb`.
- The VM persists between runs (`imon-desktop-2404`, `imon-desktop-2604`). Delete it with
  `incus delete --force imon-desktop-2404` to start fresh. Log in as `ubuntu`.
- Never test state-changing actions on instances you care about. Use the VM, or a throwaway
  container: `incus launch images:alpine/edge scratch`.

## Manual matrix

Run before every release, and for any change to `ui/` or `extension.ts`:

| Host         | GNOME | How                                                    |
| ------------ | ----- | ------------------------------------------------------ |
| Ubuntu 26.04 | 50    | Levels 4 and 5 above, and level 6 with `RELEASE=26.04` |
| Ubuntu 24.04 | 46    | Level 6 with `RELEASE=24.04`                           |

Checklist:

- [ ] Indicator appears; count matches `incus list status=running`.
- [ ] Menu shows containers and VMs across all permitted projects, running first.
- [ ] Start, Stop, Restart, Freeze and Unfreeze work, and the row updates without reopening the menu.
- [ ] Open Shell opens a terminal in the right instance and project.
- [ ] Copy address puts the primary address on the clipboard.
- [ ] No Incus installed → "Incus is not installed" state; no log spam.
- [ ] User not in the `incus`/`incus-admin` group → actionable permission hint.
- [ ] Daemon stopped → back-off visible in the logs, at most one warning; recovers on restart.
- [ ] Toggle the extension off and on 10 times. No warnings in `journalctl -f -o cat /usr/bin/gnome-shell`.
- [ ] Lock and unlock the screen: no errors, polling resumes.
- [ ] Light and dark style, 200 % scaling, large text, keyboard-only navigation, Orca reads the rows.
- [ ] Preferences open, apply live, and survive a reset.
- [ ] Tab and arrow keys reach every row, action button and both footer buttons.
- [ ] Keyboard focus stays put when another row changes state.
- [ ] With animations disabled, a pending row shows a still, dimmed dot.
- [ ] A failed action shows a notification, and its daemon text is not in the journal.

## Troubleshooting

| Symptom                                                         | Cause                                                                                                                   | Fix                                                                                                                                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `make incus-ci` says the container has no IPv4 network          | Ubuntu 26.04's systemd hangs `systemd-networkd` in unprivileged containers without nesting, so no DHCP lease and no DNS | `scripts/incus-run.sh` launches with `security.nesting=true`. For your own 26.04 containers: `incus config set <name> security.nesting=true && incus restart <name>` |
| Containers get only an IPv6 address                             | Same as above. The kernel configures IPv6 from router advertisements even when `systemd-networkd` never starts          | As above                                                                                                                                                             |
| Downloads stall inside containers                               | The bridge advertises IPv6 routes but the host has no IPv6 uplink                                                       | `scripts/ci/provision.sh` forces IPv4 for apt, curl and name resolution                                                                                              |
| `incus launch` hangs forever with no output under `make` or CI  | `incus launch` reads instance config from stdin when stdin is not a terminal, and waits on the open pipe                | Every non-interactive `incus` call in `scripts/` uses `</dev/null`; do the same in your own scripts                                                                  |
| Extension missing in a nested shell                             | Not enabled in that session                                                                                             | `make nested` enables it in its own settings database. Run `make install` first                                                                                      |
| Clicking the panel icon does nothing                            | Expected until ROADMAP T12: the indicator has no menu yet                                                               | —                                                                                                                                                                    |
| Notifications such as account sync messages in the nested shell | Session services (Online Accounts, calendar) starting in the private session                                            | Not from the extension. Ignore                                                                                                                                       |
