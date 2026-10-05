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
| T05 | `core/incus/compat.ts`: server version and api_extensions gate                                               | T04        | review |
| T06 | `core/ports.ts`, `core/incus/client.ts`: IncusClient over a Transport port                                   | T02, T04   | review |
| T07 | `core/socket.ts`, `core/cancel.ts`: socket discovery over a SocketProbe port, cancellation                   | T01        | review |
| T08 | `core/metrics.ts`, `core/format.ts`: rates, percentages and human formatting                                 | T04        | review |
| T09 | `core/monitor.ts`: polling state machine with Clock port, cadence, back-off, actions                         | T05–T08    | review |
| T10 | `core/presenter.ts`: Snapshot → ViewModel                                                                    | T08, T09   | review |
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
- Log sink: the monitor already sanitises its warnings, so the sink must not escape them again.
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

- Matches [UI_DESIGN.md](UI_DESIGN.md). Rows are diffed, not rebuilt. All strings are
  translatable. The readout column is right-aligned with a fixed `em` width, so values
  crossing 10, 100 or 1000 do not shift the layout. A '—' readout ("not available") gets an
  accessible name that says so. The `Formatter` translates unit templates once at construction, so the UI
  creates it in `enable()` (a language change takes effect on the next enable). The lifecycle checklist in [TESTING.md](TESTING.md#manual-matrix) passes on 50.

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
  - Deferred: `PresentContext` carries `locale` next to `formatter`; collapse them into one locale
    object when this task builds the context. If the UI grows `explain` or `performFailure*`,
    consider moving them to `core/failure-text.ts`.
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
