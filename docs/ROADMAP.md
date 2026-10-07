# Roadmap to 1.0

Each task is sized for **one TDD cycle by one implementer subagent**, followed by an adversarial
review ([AGENT_WORKFLOW.md](AGENT_WORKFLOW.md)). Do tasks in order unless the dependencies allow
parallel work. Update the status column in the same MR that completes the task.

Status: `todo` · `in-progress` · `review` · `done`

| ID  | Task                                                                                                         | Depends on | Status |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------- | ------ |
| T00 | Repository bootstrap: `git init`, first commit, `make hooks`, GitHub repository, first green Actions run     | —          | done   |
| T01 | `core/result.ts`, `core/errors.ts`: Result type and the `IncusError` union                                   | —          | done   |
| T02 | `core/http/request.ts`, `core/http/response.ts`: HTTP/1.1 codec                                              | T01        | done   |
| T03 | `core/incus/envelope.ts`: sync / async / error envelopes                                                     | T01        | done   |
| T04 | `core/incus/decode.ts`, `models.ts`: Server, Instance, InstanceState decoders against fixtures               | T03        | done   |
| T05 | `core/incus/compat.ts`: server version and api_extensions gate                                               | T04        | done   |
| T06 | `core/ports.ts`, `core/incus/client.ts`: IncusClient over a Transport port                                   | T02, T04   | done   |
| T07 | `core/socket.ts`, `core/cancel.ts`: socket discovery over a SocketProbe port, cancellation                   | T01        | done   |
| T08 | `core/metrics.ts`, `core/format.ts`: rates, percentages and human formatting                                 | T04        | done   |
| T09 | `core/monitor.ts`: polling state machine with Clock port, cadence, back-off, actions                         | T05–T08    | done   |
| T10 | `core/presenter.ts`: Snapshot → ViewModel                                                                    | T08, T09   | done   |
| T11 | `adapters/*`: Gio transport (+ fake server), GLib clock, settings, socket probe, launcher                    | T06, T07   | done   |
| T12 | `ui/*` + `extension.ts` composition root, stylesheet, gettext                                                | T10, T11   | done   |
| T13 | `prefs.ts`: Adw preferences                                                                                  | T11        | done   |
| T14 | Record Incus 7.0 LTS fixtures; contract tests for 6.0 and 7.0                                                | T04        | done   |
| T15 | i18n: generate `po/` template with `scripts/update-po.sh`, add Spanish translation, check `pack` compiles it | T12, T13   | done   |
| T16 | Manual matrix on GNOME 46 and 50, screenshots, README polish                                                 | T12–T15    | done   |
| T17 | Release 1.0.0 ([RELEASING.md](RELEASING.md))                                                                 | T16        | todo   |
| T18 | Private Launchpad PPA: GPG key, `dput` config, first `make ppa-source` uploads for noble and resolute        | T17        | todo   |
| T19 | Move CI to the self-hosted GitLab runner (`.gitlab-ci.yml` is ready; set runner tags)                        | T00        | todo   |
| T20 | B1: "Show log" action on the failure notification                                                            | T17        | done   |
| T21 | B2: Disk usage row in the expanded instance                                                                  | T20        | done   |
| T22 | B9–B11: stale failure notice, pager robustness, terminal prefix rules                                        | T21        | done   |
| T23 | B5: "5 of 7 running" summary line at the top of the menu                                                     | T22        | done   |
| T24 | B6: port forwards (proxy devices) in the expanded row                                                        | T23        | done   |
| T25 | Developer tooling: suites, readable output, `make doctor`, command-map docs, Makefile tests                  | T24        | done   |
| T26 | B7: notification when a running instance stops without a menu action                                         | T25        | done   |
| T27 | Notifications under the extension's own name and icon instead of "System"                                    | T26        | done   |
| T28 | Copy and accessibility polish from the whole-UI audit                                                        | T27        | done   |

## Acceptance criteria

### T01: Result and errors

- `Result<T, E>` = `{ ok: true; value: T } | { ok: false; error: E }` with `ok()`, `err()`, `map`,
  `andThen`. Nothing more until a caller needs it.
- `IncusError` kinds: `not-installed`, `permission-denied`, `unreachable`, `timeout`,
  `cancelled`, `protocol`, `decode`, `api` (with `code` and `message`), `unsupported` (with
  `reason`). Each carries only the data the UI needs.

### T02: HTTP codec

- `encodeRequest({ method, path, body? })` → `Uint8Array`, with the headers documented in
  [INCUS_API.md](INCUS_API.md#http-over-the-socket).
- `ResponseParser` is incremental: `push(chunk)` → `pending | done(response) | error`. It
  handles Content-Length, chunked (including chunk extensions and trailers) and read-to-EOF
  (`finish()`).
- Tests split every fixture response at every byte offset and assert identical results.
- Rejects responses whose headers exceed 64 KiB or whose body exceeds 32 MiB (`protocol`).

### T03: Envelopes

- Decodes all three types and validates `status_code`/`error_code` ranges. HTTP status mismatch →
  `protocol`. Covers both fixture error cases.

### T04: Decoders

- Accept every fixture in `tests/fixtures/incus/*/`. Unknown fields are ignored; missing
  required fields → `decode` error naming the JSON path.
- `InstanceStatus` derived from `status_code` (see [INCUS_API.md](INCUS_API.md#fields-we-read)).
- Primary-address selection rule tested on IPv4-only, IPv6-only, dual-stack and loopback-only
  cases.
- Metadata is `unknown`: no `as` casts, no spreading it into objects. Dynamic daemon keys
  (devices, networks) go into a `Map` and use `Object.hasOwn`; `__proto__` and `constructor` are
  ordinary keys. Test: metadata with those keys leaves `Object.prototype` and the output unchanged.
- Daemon strings that can reach the UI or logs are length-capped. Instance and project names are
  validated against Incus naming rules before they can reach argv or a URL.
- Move `isRecord` from `envelope.ts` to `decode.ts` (separate `refactor:` commit).

### T05: Compat

- Pure function of a decoded `Server`. Returns `ok` or `unsupported` with a human reason. The
  required extension list is verified against the fixtures.

### T06: Client

- `server()`, `instances({ withState })`, `changeState(ref, action)`, `wait(operation)`.
- Uses `all-projects=true` for listing and an explicit `project=` for everything else. Names
  are URL-encoded.
- All tests go through a `FakeTransport` that records requests. Asserting on exact request
  lines is the contract.
- The operation wait path is built only from the validated `Envelope.operation` plus a fixed
  suffix (`/wait?timeout=60&project=…`), never from raw JSON or metadata.
- Names and operation paths are validated and percent-encoded before any request is built, so
  the request is safe by construction. The client does not wrap port calls (ADR-0012); the
  transport adapter encodes the request and maps any encode failure to `protocol`.

### T07: Socket discovery

- Order and override as documented in INCUS_API.md#sockets: the first usable candidate wins;
  with none, `permission-denied` if any candidate was denied, else `not-installed`.
- Introduces `core/cancel.ts` and the total-port convention (ADR-0012): `SocketProbe.access`
  never rejects and takes a `CancelSignal`; discovery returns `cancelled` when aborted.

### T08: Metrics and formatting

- CPU % from two samples; first sample → `null` (unknown), not 0. Counter reset (restart) →
  `null`, never negative.
- `cpuAllocatedNsPerSecond` or `memoryTotalBytes` of 0 means "not reported": CPU % and memory %
  are `null`, never Infinity or NaN. Network sums can drop when an interface disappears: a
  negative delta → `null` rate.
- Network rates exclude loopback. Memory shown as used/total.
- Formatting uses injected `locale` and gettext; tests pin `en` and one other locale.

### T09: Monitor

- State machine: `idle → connecting → ready ⇄ refreshing`, `→ failed(error)` with back-off.
  Transitions are table-tested.
- Cadence: closed = `refresh-interval` with recursion 1; open = 2 s with recursion 2; immediate
  refresh on open and after every action.
- Never more than one request in flight per stream. `dispose()` cancels everything; no callbacks
  fire afterwards (tested with FakeClock).
- `perform(action, ref)` serialises actions per instance and rejects actions invalid for the
  current state.
- One `CancelSource` per `enable()`, cancelled in `disable()`. A `cancelled` result is a silent
  stop: no UI state, no back-off, no log. A top-level catch around the polling loop prevents
  an unhandled rejection after `disable()` if a port breaks its contract.
- A `cancelled` result after a successful state change is not a failure: the action proceeds
  on the server, so the monitor just refreshes.
- Re-runs socket discovery after a connection failure; reads `INCUS_SOCKET` via the composition
  root (`GLib.getenv(...) ?? undefined`).
- Logs only `detail` from protocol errors, at warn level, once per failure episode (until the next success).
  Log output is sanitised once at the sink: C0/C1 controls, U+2028/U+2029 and bidi overrides
  are replaced.

### T10: Presenter

- Deterministic `ViewModel` (sorting, labels, dot class, actions, readout strings, accessible
  names). Snapshot-tested against builders, not against UI.
- `unsupported` from `Monitor.perform` carries a non-user string; the presenter maps it to
  translated text and never shows it raw.
- `processes < 0` means "not reported": never rendered as a count; it selects "Open Console" for
  VMs.
- The presenter returns plain data; `Sampler.record(snapshot)` runs before `present(snapshot)`.
  `performFailureTitle` and `performFailureMessage` give the notification text of a failed
  action; a null message means nothing is shown.

### T11: Adapters

- GJS tests against a fake `Gio.SocketService`: success, chunked, stall → timeout, close mid-body,
  permission denied, missing socket, cancellation during connect, read and write.
- The launcher builds argv only. Terminal detection order: setting, `xdg-terminal-exec`,
  `ptyxis`, `kgx`, `gnome-terminal`. Each is unit-tested for argv shape.
- The clock tracks and removes every source on `dispose()`. Pitfalls: the callback wrapper
  returns `SOURCE_REMOVE`; cancel is a no-op after the timer fired or was cancelled (source IDs
  are reused); `now()` is monotonic.
- Socket probe (no connect): `query_info_async('standard::type,access::can-write')`.
  NOT_FOUND / NOT_DIRECTORY → `missing`; PERMISSION_DENIED (including an inaccessible parent
  such as a 0700 `/var/lib/incus`) or `can-write = false` → `denied`; not a socket → `missing`;
  any other error → `missing`, logged once with `console.warn`. GJS tests for each case.
- The transport gives `wait` requests their own deadline (the 60 s server-side wait plus a
  margin) instead of the 10 s request timeout.
- Every adapter bridges `CancelSignal` to `Gio.Cancellable` and never rejects (ADR-0012). Adapters unsubscribe
  their `onCancel` registration in `finally`, so a long-lived signal does not accumulate callbacks.
- The transport feeds `ResponseParser.push()` with bounded reads (at most 64 KiB per call, one
  read per main-loop dispatch), so a hostile peer cannot monopolise the compositor.

### T12: UI

- `ui/clipboard.ts`: `St.Clipboard` write on an explicit user action (it needs St, so it is not an
  adapter). Moved here from T11.
- The composition root's log port (`console.warn`): the monitor already sanitises its warnings,
  so the port must not escape them again.
- Matches [UI_DESIGN.md](UI_DESIGN.md). Rows are diffed, not rebuilt. All strings are
  translatable. The readout column is right-aligned with a fixed `em` width, so values
  crossing 10, 100 or 1000 do not shift the layout. A '—' readout ("not available") gets an
  accessible name that says so. The `Formatter` translates unit templates once at construction, so the UI
  creates it in `enable()` (a language change takes effect on the next enable). The lifecycle checklist in [TESTING.md](TESTING.md#manual-matrix) passes on 50.
- `GioSettings` is not passed to `Monitor` as-is. The root builds `MonitorDeps.settings` itself:
  `refreshIntervalSeconds` as a live getter over `GioSettings`, and `socketOverride` from the
  `INCUS_SOCKET` environment variable via `GLib.getenv('INCUS_SOCKET') ?? undefined` (there is
  no socket-override GSettings key).
- Dispose the `Monitor` last in `disable()`, or inside `try`/`catch`, because
  `CancelSource.cancel()` rethrows. The monitor reads settings live but a changed socket override
  needs a new `Monitor`, so settings changes recreate it.

- Owns the pending-action state: action buttons insensitive and the dot pulsing, keyed by
  `Row.key`. Calls `Sampler.record` before `present` on each snapshot.
  - Pending is a set of `Row.key`: a key is added before `Monitor.perform` and removed when it
    settles, whatever the outcome, and keys absent from the rows are pruned on each render.
    Several rows may be pending at once. `Row.busy` (a transitional state reported by the daemon)
    looks the same: the dot pulses and no actions are offered.
  - Expansion state of rows is keyed by `Row.key` and survives re-renders.
  - A `loading` view model keeps the previously rendered menu if there is one. The monitor never
    emits `failed:cancelled` after `ready`, so this is a defensive rule.
  - Accessible text is built from translated templates, never by concatenating sentences. `DASH`
    in the details is announced as a translated "Not available", and the spoken download and
    upload text uses a translated template. The instance type is conveyed by the icon only: the
    row's accessible name does not need it.
  - Deferred to T15: `PresentContext` still carries `locale` next to `formatter`; collapse them into
    one locale object. The launch-failure text now lives in `core/menu-text.ts`; if `explain` and
    `performFailure*` follow it, move them to `core/failure-text.ts`.
- Owns the detail headings and their translations (Memory, Network, Address, Uptime), the Retry,
  Refresh and Preferences buttons, the accessible name of the copy-address button, and the
  spoken download and upload text for the rates.
- Shows only the footer for a `loading` view model.
- No markup in St labels (`use_markup` off) or in notification bodies: names and Incus messages
  are untrusted text.
- Raises failures with `performFailureTitle` and `performFailureMessage`.

### T13: Preferences

- Four rows bound with `Gio.Settings.bind` where possible. No Shell imports (lint).

### T14: Incus 7.0 fixtures

- Launch Incus 7.0 in an Incus VM (Zabbly `stable` repository), create a container, a VM, a
  stopped and a frozen instance, and run `scripts/record-fixtures.py --version 7.0`. Every
  decoder test runs against both series (`describe.each`).

### T16: Manual matrix

- Stop on a frozen instance: run it on a throwaway instance you created, and confirm that the
  graceful stop succeeds or that Incus reports an error the notification shows.
- Nested shell, GNOME 46 and 50, for the UI paths that no test can run: the readout column
  position in a collapsed row, the pulse while a row is pending and with animations disabled,
  focus after a state change in another row and after an action settles, Tab and arrow reach of
  the action and footer buttons, the dim label contrast on light and dark, and a preferences
  window whose Terminal row keeps no stray apply checkmark. The checklist is in
  [TESTING.md](TESTING.md#manual-matrix).

### T20: Show log on a failed action (B1)

- A failed lifecycle action (start, stop, restart, freeze, unfreeze) keeps its notification and
  adds one button, "Show log", that opens the terminal on that instance's log, only when the
  daemon answered with an error or timed out (`api`, `timeout`). Other failures (no terminal
  found, socket errors, undecodable replies) get no button. The notification stays in the tray
  while it has the button.
- `core/launch.ts` gains a `log` target. Its argv is built from validated names only, as for
  `shell` and `console`: `incus info <name> --project <project> --show-log`, kept open for
  reading: the output goes through the `less` pager (scroll, `q` to quit), so the terminal stays
  open until the user quits. No shell string is built from names; the fixed `sh -c` wrapper
  receives them as separate argv entries. Terminals whose `-e` takes one string are unsupported.
- A launch failure from the button reports through the existing launch-failure notification.
- The notification API used exists on GNOME 46 and 50 with the same behaviour (the constructor
  takes one properties object on both) and is recorded in [COMPATIBILITY.md](COMPATIBILITY.md).
  The extension owns no source: it uses the shell's system source. Clicking the button or
  dismissing the notification leaves nothing behind, and `disable()` destroys the pending
  notification.
- New strings go through gettext and the `po/` template is regenerated.
- Manual: trigger a failure on a throwaway instance (stop a frozen one, see T16) on GNOME 46 and
  50 and check the button opens the log.

### T21: Disk usage row (B2)

- Fixtures first: record `instances-recursion2` from an instance on a Btrfs pool (with and without
  a root quota) for Incus 6.0 (the desktop VM `imon-desktop-2404` has pool `imon-btrfs` with
  `imon-btrfs-c1` and `imon-btrfs-quota`) and for 7.0 if an Incus 7.0 host is available; if it is
  not, record 6.0 only and say so in the task report. Scrub like `scripts/record-fixtures.py`.
- `core/incus/decode.ts` reads `state.disk.root` as `{usage, total}` into `InstanceState`
  (absent, `{}` or a non-root-only map means "not reported"; a present value of the wrong type is a
  `decode` error naming its path). Decoder tests run against both series' fixtures.
- The expanded row shows one "Disk" row, like the existing memory row: "X of Y" when `total` is
  above 0 and "X" when it is 0. The row is absent on pools that report nothing (`dir`).
  The spoken form follows the existing readouts, and every string goes through gettext.
- Icon, if any, only from [UI_DESIGN.md](UI_DESIGN.md#icons); keep the expanded row's layout and
  the panel-with-separation styling intact. Row heights stay stable between polls.
- [INCUS_API.md](INCUS_API.md) lists the field and the `dir` quirk it already records.
- Manual: a Btrfs-backed instance in the VM on GNOME 46 and a `dir` instance on 50 (no row).

### T22: Failure notice and log view polish (B9, B10, B11)

- B9: a successful action on an instance destroys the pending failure notification for that
  instance (and only that one: a failure for another instance stays). Decision logic in core
  with unit tests; the notification object stays in `ui/replaceable-notice.ts`.
- B10: the `log` target script neutralises the user's `LESS` for the call (a short log must keep
  the terminal open even when `LESS` has `-F`), and uses `less` when no `PAGER` is set; names stay
  positional and absent from the script text. If no pager can run, the terminal still shows the
  log and waits (no flash-and-close). Argv tests pin all of this.
- B11: documented, not guessed. The Terminal setting's command is appended as separate arguments;
  `docs/UI_DESIGN.md` and the preference text say so, with working examples, and name the
  terminals that take one command string (`xfce4-terminal -e`, `mate-terminal -e`) as unsupported.
  No join rule exists in `core/terminal-command.ts`.

### T23: Summary line in the menu (B5)

- The list view model carries `summary: string | null`: "{running} of {total} running", where
  `total` counts every instance Incus returned (also the stopped ones hidden by the
  show-stopped setting) and `running` is the same count as the panel's. `null` when there is
  only one instance, because "1 of 1 running" says nothing. The text uses `ngettext` on `total`
  with a translator comment, and numbers go through `formatCount`.
- The `ui/` shows it as one inert line above the instance list, outside the reordered section
  (the row reorder code must not see it), visible only in the list view. It is not focusable,
  adds no icon and no new style beyond the existing notice/label styling, and its height does not
  jump between polls with an unchanged summary (the label is updated only when the text changes).
- The panel keeps its single number and its accessible name. The line is readable by a screen
  reader as it is.
- Strings in `po/` regenerated; `es` translated. [UI_DESIGN.md](UI_DESIGN.md) describes the line.
- Manual: 1 instance (no line), several with some stopped, the show-stopped setting off.

### T24: Port forwards in the expanded row (B6)

Fixture: `tests/fixtures/incus/6.0/instances-recursion1-proxy.json`, recorded from Incus 6.0.6.
Incus keeps proxy devices in `expanded_devices` as `{ "type": "proxy", "listen": "tcp:0.0.0.0:8000-8002",
"connect": "tcp:127.0.0.1:9000-9002" }`. Observed: the `incus-user` project (`user-<uid>`) is
restricted and answers "Proxy devices are forbidden", so the row shows up for system-socket users only.

- The instance model gets `forwards: readonly Forward[]`, decoded from `expanded_devices` entries of
  type `proxy` whose `listen` and `connect` are `tcp:` or `udp:` with a host and a port or a port
  range (`a-b`), with `bind` absent or `host`. In device-key order, at most 64. The row shows ports only (no listen host, so loopback versus all interfaces is not shown); `bind=instance` and comma-separated port lists are skipped. A `unix:` side, another protocol or a malformed
  value skips that device; it never makes the whole list a `decode` error, because it is
  configuration, not state.
- The row presenter adds a `forwards` line only when there is at least one: "tcp 18080 → 80",
  ranges as "tcp 8000-8002 → 9000-9002", up to 3 entries, then "+N more" (`ngettext`). Numbers go
  through the existing formatters. It is shown whatever the instance state, since it is configuration.
- The `ui/` adds one inert detail row in the expanded instance, following the existing detail rows
  and their accessibility pattern. No new style, no icon beyond the existing ones, and the row's
  text is updated only when it changes.
- Strings in `po/` regenerated; `es` translated. [UI_DESIGN.md](UI_DESIGN.md) and
  [INCUS_API.md](INCUS_API.md#fields-we-read) describe the field.
- Manual (system socket): an instance with one forward, several, a range, a `unix:` listener only
  (no row), and none (no row).

### T25: Developer tooling: suites, readable output, doctor, docs, tests

The Makefile is the single entry point, but it has no tests, its three suites (test, build, release)
are not named as such, and its output is plain. Names used by CI, the git hooks and
`.claude/settings.json` (`ci`, `check`, `lint`, `test`, `test-gjs`, `build`, `zip`, `format`,
`incus-ci`, `incus-ci-all`, `incus-package`, `changelog-preview`, `release`, `smoke`, `nested`,
`install`) keep their names; `logs` becomes `shell-logs`.

- **Suites.** `make help` opens with a three-line quick start and groups targets as Test suite, Build
  suite, Release suite, then Run and verify, Clean environments, Housekeeping. A new `make test-all`
  runs `check` and `test-gjs`, which is the local gate in the pre-push hook. The variables users may
  set (`RELEASE`, `SERIES`, `SCHEME`, `VM`, `BUMP`, `NEW_VERSION`) are listed in the help.
- **Readable output.** One small helper, `scripts/lib/ui.sh`, prints steps, info, success, warning
  and failure lines with an emoji and a colour per level, and a final line with the elapsed time.
  The Makefile and the scripts that make calls first (`build`, `pack`, `build-deb`, `check-icons`,
  `test-gjs`, `ppa-source`) use it. Plain ASCII and no colour when stdout is not a terminal,
  `NO_COLOR` is set or `CI` is set; the emoji need a UTF-8 locale. Errors go to stderr. Nothing
  else about what the scripts do changes, and the `incus` scripts are out of scope.
- **`make doctor`.** Read-only: reports each required tool (node and the `.nvmrc` version, npm,
  python3, gjs, zip, gettext, glib-compile-schemas, gnome-extensions) and each optional one
  (incus, mutter-dev-bin, virt-viewer, debhelper), with the command that installs what is missing.
  Exit code 1 only when a required tool is missing.
- **Docs.** A command map in `docs/TESTING.md` (what each suite runs, how long, what it needs), a
  quick start in `CONTRIBUTING.md` of at most ten lines, a header in the Makefile that explains the
  suites, and a comment above each target group. `docs/RELEASING.md` names the release suite targets.
- **Tests** (`scripts/tests/`, run by `make check`): every target has a description and a section;
  `make help` lists exactly the documented targets; every `make <target>` mentioned in the docs,
  `.claude/` and the scripts exists; `make -n` of each non-destructive target succeeds; `make
help` and the helper emit no escape codes and no emoji when not on a terminal, with `NO_COLOR`
  or with `CI`; `doctor` exits 1 with a required tool missing from `PATH` and 0 otherwise.
- Manual: `make help` and `make check` in a terminal (colour, emoji, elapsed time), and `make check`
  piped to a file (plain).

### T26: Stopped-unexpectedly notification

A running instance that leaves `running` for `stopped` or `error` while no action on it was started
from the menu is a crash, an out-of-memory kill, or a stop from a terminal. Incus does not say
which, so all three are reported; the text says what was seen, not why.

- **Detection** is a small stateful class in `core/` with no I/O, over two consecutive snapshots that both carry
  instances (`ready`, or `refreshing` with its previous list): an instance running in the earlier
  one and `stopped` or `error` in the later one is reported. Never reported: the first snapshot
  after `enable()`, a reconnect after `unreachable`/`timeout` (no earlier list), an instance that
  vanished (deleted or its project hidden), `busy`, `frozen`, `unknown`, and a restart that went
  through `busy` between two polls.
- **Menu actions are excluded.** Any key with an action in flight in `extension.ts` is skipped,
  and the snapshot that `perform` refreshes before it returns is covered by that. While the action is
  pending, a stop that the menu started never produces a second notification; a stop that
  completes after the wait was cut off (timeout) may still be reported, which is accepted.
- **One notification per poll, not per instance.** Several instances in one poll give one
  notification listing up to 3 names, then "+N more" (`ngettext`). Each instance is reported once
  per transition: it must be seen running again before it can be reported again.
- **Notification.** Title "Instance stopped" / "N instances stopped" (translated, with the name in
  the body for one), body "<name> is no longer running." and for `error` "<name> is in an error
  state.". Names are the validated instance names; with several projects the project is not added.
  It is transient, has no button, and replaces the previous one of its kind. The extension creates
  it through the existing system-source pattern of `ReplaceableNotice` and destroys it in `disable()`. T28 later renamed the titles to "Instance not running" and "N instances not running", because the text is also true for `error`.
- **Transient on purpose.** The extension cannot tell a crash from a deliberate stop, so the
  notification leaves no entry in the tray.
- **No setting, no UI change** in the menu. The panel icon and rows are untouched.
- Strings in `po/` regenerated; `es` translated. [UI_DESIGN.md](UI_DESIGN.md) and
  [ARCHITECTURE.md](ARCHITECTURE.md) mention it.
- Manual (throwaway container): `incus exec <c> -- kill -9 1`, or a stop from a terminal, shows the
  notification once; a stop from the menu shows none; a restart from the menu shows none.

### T27: Notifications under the extension's own name

Both notifications (failed action, unexpected stop) are filed under the shell's "System" source with
its gear icon, which reads as the operating system speaking. They should read as Incus Monitor.

- **Own source.** The extension creates one `MessageTray.Source` titled "Incus Monitor" (a product
  name, not translated) with the panel's icon, `package-x-generic-symbolic`, and adds it to the
  message tray when the first notification is shown. [ADR-0006](adr/0006-adwaita-icons-only.md) stands: no Incus
  logo, no bundled artwork.
- **Lifecycle.** The source is destroyed in `disable()` with the notifications, and a second
  `enable()` after it creates a new one. No notification or source outlives `disable()`.
- **Compatibility.** The `Source` constructor and the way a source joins the tray must work on
  GNOME 46 and 50. The ledger in [COMPATIBILITY.md](COMPATIBILITY.md) lists each call with the oldest version
  checked in the shell's own source, and `getSystemSource` leaves the ledger if it is no longer used.
- **No behaviour change** otherwise: transient or persistent as before, one notification at a time,
  the same texts.
- Manual: both notifications show "Incus Monitor" and the panel icon in the banner and in the tray
  (the failure one), on a nested shell; `enable(); disable(); enable()` leaves one source.

### T28: Copy and accessibility polish (UI audit)

A read-only audit of the whole surface found small, verified defects. Each is a wording or
detail fix with no new feature, setting or string beyond the replacements below.

- **Panel name on failure.** The accessible name is the notice text alone. The wrapper msgid
  "Incus, {problem}" is removed from the code, `po/incus-monitor@patricioaumedes.pot` and `po/es.po`.
- **Unexpected-stop title.** A neutral wording that is true for `stopped` and `error`:
  "Instance not running" and "{count} instances not running" replace the two titles that say
  "stopped". The body texts stay.
- **Locale-aware counts.** `stoppedNotice` and the stopped-instances notice format counts with
  `formatCount` and the context locale, like the rest of the menu.
- **Copy button with no address.** It carries an empty accessible name while it is hidden and
  inert, so a screen reader never reads "Copy address —". It stays in the accessibility tree as an
  unnamed button that cannot be focused or activated; removing it would change the row's height.
  The empty name is valid on GNOME 46 and 50 (checked in the shell and Clutter sources).
- **Terminal row help.** The explanation sits directly above the Terminal field, in a group of its
  own, and fits on one line at the window's default width. English "Leave empty to detect one.
  Example: “xterm -e”." and Spanish "Déjelo vacío para detectarla. Ejemplo: «xterm -e».". No comma in
  the English msgid (the literal-string test in `prefs.test.ts` stops at the first one). The
  separate-arguments constraint stays in UI_DESIGN.
- **Punctuation.** A final period on "This instance name cannot be used to open a terminal"
  (and es), and typographic quotes in the msgid `Add your user to the “incus” group, then log in again`.
- **Clipboard wording** in README and `metadata.json`: "It writes to the clipboard only when you
  press the copy button next to an address."
- **Docs.** README: bullet capitalisation, and the sentence that repeats the Requirements table is
  removed. UI_DESIGN says what `stylesheet.css` really contains (status dot, tabular numerals, dim
  text, the details panel and its layout), and that high contrast is not measured.
- Not done on purpose: turning off the preferences search (`search_enabled` is deprecated since libadwaita 1.6 and needs a lint exception for nothing visible), renaming "Forwards", a Loading row, tooltips, copy feedback, an install hint,
  extra screenshot scenarios. A README screenshot waits for the maintainer.
- Manual: the nested shell shows the new titles; a screen
  reader reads the error states once.

## After 1.0: backlog

Ideas the maintainer wants kept, in rough priority order. None is scheduled. Before starting one,
write its acceptance criteria here as a task, then follow the usual workflow. Each keeps the
rules in [ENGINEERING.md](ENGINEERING.md): minimal UI, no new runtime dependencies, Adwaita
icons only, a fixture recorded from a real Incus for every new field.

- **B1: "Show log" on a failed action.** The failure notification gets an action that opens a
  terminal running `incus info <name> --show-log` (project passed), through the existing
  launcher. Incus also serves per-instance logs under `/1.0/instances/<name>/logs`.
- **B2: Disk usage row.** `state.disk.root` is `{usage, total}`; `total` is 0 without a quota and
  the quota otherwise. Verified on Incus 6.0.5 with a Btrfs pool in the desktop VM (50 MiB
  written showed `usage: 52908032, total: 0`; a 1 GiB root quota showed `total: 1073741824`).
  `dir` pools report `{}`, so the row is hidden when absent. Record fixtures from a Btrfs pool
  (and ZFS if available) for both Incus series first.
- **B3: Group instances by project.** Today the list is flat, with the project shown on each
  row when more than one project is visible. Group under a heading per project when there is
  more than one, keeping running-first order inside a group and the stable order while the menu
  is open. Groups for other resources (networks, volumes) are out of scope: this extension
  monitors instances.
  **Design review (T26 session): recommended not to build.** Running-first across projects answers the
  menu's one question better than groups; headings need a custom inert item, new frozen-order rules
  and have no heading semantics for screen readers. The per-row project label already covers it.
  Revisit only if users ask.
- **B4: "More" details.** An optional collapsed section in the expanded row with the image
  description, last-used time, `limits.cpu` / `limits.memory` and swap usage. Needs a design
  review first: the expanded row is already four rows plus actions.
  **Design review: recommended not to build.** A collapsed section inside an expanded row is two
  levels of disclosure in a transient menu; the data belongs in `incus info`. If one field proves
  valuable, add it as a single row.
- **B7:** now T26.
- **B8: Pinned favourites and a filter** for long lists.
  **Design review.** Filter: recommended not to build (an `St.Entry` in a PopupMenu fights the menu's
  key handling and Orca, and "show stopped instances" off already shortens long lists). Pins:
  deferred until users ask; if built, a `pinned` GSettings key (`as`, `project/name`, at most 50,
  never pruned automatically), a Pin/Unpin item in the expanded row, pinned tier above running,
  order frozen while open, "Pinned" in the accessible name.
