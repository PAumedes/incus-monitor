# Roadmap to 1.0

Each task is sized for **one TDD cycle by one implementer subagent**, followed by an adversarial
review ([AGENT_WORKFLOW.md](AGENT_WORKFLOW.md)). Do tasks in order unless the dependencies allow
parallel work. Update the status column in the same MR that completes the task.

Status: `todo` · `in-progress` · `review` · `done`

| ID  | Task                                                                                                         | Depends on | Status |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------- | ------ |
| T00 | Repository bootstrap: `git init`, first commit, `make hooks`, GitHub repository, first green Actions run     | —          | todo   |
| T01 | `core/result.ts`, `core/errors.ts`: Result type and the `IncusError` union                                   | —          | todo   |
| T02 | `core/http/request.ts`, `core/http/response.ts`: HTTP/1.1 codec                                              | T01        | todo   |
| T03 | `core/incus/envelope.ts`: sync / async / error envelopes                                                     | T01        | todo   |
| T04 | `core/incus/decode.ts`, `models.ts`: Server, Instance, InstanceState decoders against fixtures               | T03        | todo   |
| T05 | `core/incus/compat.ts`: server version and api_extensions gate                                               | T04        | todo   |
| T06 | `core/ports.ts`, `core/incus/client.ts`: IncusClient over a Transport port                                   | T02, T04   | todo   |
| T07 | `core/socket.ts`: socket discovery over a FileProbe port                                                     | T01        | todo   |
| T08 | `core/metrics.ts`, `core/format.ts`: rates, percentages and human formatting                                 | T04        | todo   |
| T09 | `core/monitor.ts`: polling state machine with Clock port, cadence, back-off, actions                         | T05–T08    | todo   |
| T10 | `core/presenter.ts`: Snapshot → ViewModel                                                                    | T08, T09   | todo   |
| T11 | `adapters/*`: Gio transport (+ fake server), GLib clock, settings, file probe, launcher, clipboard           | T06, T07   | todo   |
| T12 | `ui/*` + `extension.ts` composition root, stylesheet, gettext                                                | T10, T11   | todo   |
| T13 | `prefs.ts`: Adw preferences                                                                                  | T11        | todo   |
| T14 | Record Incus 7.0 LTS fixtures; contract tests for 6.0 and 7.0                                                | T04        | todo   |
| T15 | i18n: generate `po/` template with `scripts/update-po.sh`, add Spanish translation, check `pack` compiles it | T12, T13   | todo   |
| T16 | Manual matrix on GNOME 46 and 50, screenshots, README polish                                                 | T12–T15    | todo   |
| T17 | Release 1.0.0 ([RELEASING.md](RELEASING.md))                                                                 | T16        | todo   |
| T18 | Private Launchpad PPA: GPG key, `dput` config, first `make ppa-source` uploads for noble and resolute        | T17        | todo   |
| T19 | Move CI to the self-hosted GitLab runner (`.gitlab-ci.yml` is ready; set runner tags)                        | T00        | todo   |

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

### T05: Compat

- Pure function of a decoded `Server`. Returns `ok` or `unsupported` with a human reason. The
  required extension list is verified against the fixtures.

### T06: Client

- `server()`, `instances({ withState })`, `changeState(ref, action)`, `wait(operation)`.
- Uses `all-projects=true` for listing and an explicit `project=` for everything else. Names
  are URL-encoded.
- All tests go through a `FakeTransport` that records requests. Asserting on exact request
  lines is the contract.

### T07: Socket discovery

- Order and env override as documented. Permission-denied on a socket that exists stops the
  search with `permission-denied`, unless a later candidate is usable.

### T08: Metrics and formatting

- CPU % from two samples; first sample → `null` (unknown), not 0. Counter reset (restart) →
  `null`, never negative.
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

### T10: Presenter

- Deterministic `ViewModel` (sorting, labels, dot class, actions, readout strings, accessible
  names). Snapshot-tested against builders, not against UI.

### T11: Adapters

- GJS tests against a fake `Gio.SocketService`: success, chunked, stall → timeout, close mid-body,
  permission denied, missing socket, cancellation during connect, read and write.
- The launcher builds argv only. Terminal detection order: setting, `xdg-terminal-exec`,
  `ptyxis`, `kgx`, `gnome-terminal`. Each is unit-tested for argv shape.
- The clock tracks and removes every source on `dispose()`.

### T12: UI

- Matches [UI_DESIGN.md](UI_DESIGN.md). Rows are diffed, not rebuilt. All strings are
  translatable. The lifecycle checklist in [TESTING.md](TESTING.md#manual-matrix) passes on 50.

### T13: Preferences

- Four rows bound with `Gio.Settings.bind` where possible. No Shell imports (lint).

### T14: Incus 7.0 fixtures

- Launch Incus 7.0 in an Incus VM (Zabbly `stable` repository), create a container, a VM, a
  stopped and a frozen instance, and run `scripts/record-fixtures.py --version 7.0`. Every
  decoder test runs against both series (`describe.each`).
