# Roadmap to 1.0

Each task is sized for **one TDD cycle by one implementer subagent**, followed by an adversarial
review ([AGENT_WORKFLOW.md](AGENT_WORKFLOW.md)). Do tasks in order unless the dependencies allow
parallel work. Update the status column in the same MR that completes the task.

Status: `todo` · `in-progress` · `review` · `done`

| ID  | Task                                                                                                         | Depends on | Status |
| --- | ------------------------------------------------------------------------------------------------------------ | ---------- | ------ |
| T00 | Repository bootstrap: `git init`, first commit, `make hooks`, GitHub repository, first green Actions run     | —          | done   |
| T01 | `core/result.ts`, `core/errors.ts`: Result type and the `IncusError` union                                   | —          | review |
| T02 | `core/http/request.ts`, `core/http/response.ts`: HTTP/1.1 codec                                              | T01        | review |
| T03 | `core/incus/envelope.ts`: sync / async / error envelopes                                                     | T01        | review |
| T04 | `core/incus/decode.ts`, `models.ts`: Server, Instance, InstanceState decoders against fixtures               | T03        | review |
| T05 | `core/incus/compat.ts`: server version and api_extensions gate                                               | T04        | todo   |
| T06 | `core/ports.ts`, `core/incus/client.ts`: IncusClient over a Transport port                                   | T02, T04   | todo   |
| T07 | `core/socket.ts`, `core/cancel.ts`: socket discovery over a SocketProbe port, cancellation                   | T01        | review |
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
- `encodeRequest` throws on an invalid path. The client never lets that escape: names are
  validated and percent-encoded first, and any residual throw becomes a `protocol` error.

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
- Re-runs socket discovery after a connection failure; reads `INCUS_SOCKET` via the composition
  root (`GLib.getenv(...) ?? undefined`).
- Logs only `detail` from protocol errors, at warn level, at most once per state transition.
  Log output is sanitised once at the sink: C0/C1 controls, U+2028/U+2029 and bidi overrides
  are replaced.

### T10: Presenter

- Deterministic `ViewModel` (sorting, labels, dot class, actions, readout strings, accessible
  names). Snapshot-tested against builders, not against UI.
- `processes < 0` means "not reported": never rendered as a count; it selects "Open Console" for
  VMs.

### T11: Adapters

- GJS tests against a fake `Gio.SocketService`: success, chunked, stall → timeout, close mid-body,
  permission denied, missing socket, cancellation during connect, read and write.
- The launcher builds argv only. Terminal detection order: setting, `xdg-terminal-exec`,
  `ptyxis`, `kgx`, `gnome-terminal`. Each is unit-tested for argv shape.
- The clock tracks and removes every source on `dispose()`.
- Socket probe (no connect): `query_info_async('standard::type,access::can-write')`.
  NOT_FOUND / NOT_DIRECTORY → `missing`; PERMISSION_DENIED (including an inaccessible parent
  such as a 0700 `/var/lib/incus`) or `can-write = false` → `denied`; not a socket → `missing`;
  any other error → `missing`, logged once with `console.warn`. GJS tests for each case.
- Every adapter bridges `CancelSignal` to `Gio.Cancellable` and never rejects (ADR-0012). Adapters unsubscribe
  their `onCancel` registration in `finally`, so a long-lived signal does not accumulate callbacks.
- The transport feeds `ResponseParser.push()` with bounded reads (at most 64 KiB per call, one
  read per main-loop dispatch), so a hostile peer cannot monopolise the compositor.

### T12: UI

- Matches [UI_DESIGN.md](UI_DESIGN.md). Rows are diffed, not rebuilt. All strings are
  translatable. The lifecycle checklist in [TESTING.md](TESTING.md#manual-matrix) passes on 50.

### T13: Preferences

- Four rows bound with `Gio.Settings.bind` where possible. No Shell imports (lint).

### T14: Incus 7.0 fixtures

- Launch Incus 7.0 in an Incus VM (Zabbly `stable` repository), create a container, a VM, a
  stopped and a frozen instance, and run `scripts/record-fixtures.py --version 7.0`. Every
  decoder test runs against both series (`describe.each`).
