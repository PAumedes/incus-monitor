# Engineering principles

These rules apply to every change. Reviewers (human and agent) cite them by section anchor.

## 1. Less is more

- Every line has to earn its place. Delete before adding.
- No speculative generality: no option, abstraction or parameter without a current caller.
- One way to do each thing. If two modules solve the same problem, merge them.
- The extensions.gnome.org (EGO) review rejects code with "large amounts of unnecessary code,
  inconsistent style, imaginary API usage, LLM prompt comments". We hold ourselves to a stricter
  bar than that.

Refactoring follows Martin Fowler's discipline: two hats, small named steps, always under green
tests. The working catalog is `.claude/skills/refactoring/SKILL.md`.

## 2. Correctness first

- **Make illegal states unrepresentable.** Use tagged unions (`{ kind: 'running', … }`) instead of
  boolean flags, and `readonly` data.
- **Parse, don't validate.** JSON from Incus is `unknown` until a decoder in `core/incus/decode.ts`
  turns it into a domain type or returns a `DecodeError`. Never use `as` casts on external data.
- **Errors are values.** Functions that can fail return `Result<T, IncusError>`. Exceptions are
  only for programmer errors (violated invariants), and no exception escapes a module boundary.
- **Exhaustiveness.** Every `switch` over a union is exhaustive (enforced by
  `@typescript-eslint/switch-exhaustiveness-check`).
- **No `any`**, no non-null assertions in `src/`, no `@ts-ignore`. A `@ts-expect-error` needs a
  comment explaining why, plus an issue link.

## 3. Lifecycle

GNOME Shell may enable and disable an extension many times in one session (screen lock, user
toggle, shell updates). The EGO review guidelines are mandatory:

- Nothing happens at import time or in the constructor except static data. All work starts in
  `enable()`.
- Everything created in `enable()` is destroyed in `disable()`: widgets (`destroy()`), signal
  handlers (disconnect by stored ID, or `connectObject`/`disconnectObject`), main-loop sources
  (`GLib.Source.remove`), in-flight I/O (`Gio.Cancellable.cancel()`), GSettings objects, and
  subprocesses we still track.
- After `disable()`, no callback may touch a destroyed object. Every async continuation checks
  its cancellable or a `disposed` flag before touching UI.
- `enable(); disable(); enable(); disable();` must leave the shell exactly as it was. This is part
  of the manual test matrix ([TESTING.md](TESTING.md#manual-matrix)).
- No `session-modes`: the extension is disabled on the lock screen, by design.

## 4. Asynchrony and the main loop

- Never block the compositor. No synchronous I/O in the shell process: no `*_sync` Gio calls, no
  `GLib.spawn_sync`, no `GLib.file_get_contents`.
- One request in flight per poll stream. A slow daemon must not pile up requests: the next poll is
  scheduled only after the previous one settles.
- Every async operation accepts a `Gio.Cancellable` (adapters) or an `AbortSignal`-like token
  (core ports) and honours it promptly.
- Timeouts are explicit: connect 2 s, request 10 s, operation wait 60 s. Constants live in one
  place (`core/monitor.ts`).

## 5. Security

The full threat model is in [SECURITY.md](../SECURITY.md). In short:

- Only the local unix socket. No network listeners, no TLS remotes in v1, no telemetry.
- Subprocesses are spawned with an argv array (`Gio.Subprocess`) and never through a shell.
  Instance and project names are validated against Incus naming rules before reaching argv.
- No privilege escalation. If the user cannot reach a socket, we explain how to join the right
  group. We never call `pkexec` or `sudo`.
- No secrets are logged. Error messages shown to users contain only the Incus error string and our
  own text.

## 6. Performance budget

| Metric                                        | Budget                                                     |
| --------------------------------------------- | ---------------------------------------------------------- |
| Work on the main loop per poll (50 instances) | < 2 ms parse + < 2 ms render diff                          |
| Idle polling (menu closed)                    | 1 request per `refresh-interval` (≥ 2 s)                   |
| Allocations                                   | No per-poll widget re-creation; rows are diffed and reused |
| Startup (`enable()` → first paint)            | Indicator visible immediately; data async                  |

## 7. Logging

- `console.error` for unexpected failures that need a bug report. `console.warn` for degraded but
  handled conditions, at most once per state transition (never once per poll).
- No `console.log`/`console.debug` in shipped code (lint-enforced).

## 8. Internationalisation and accessibility

- All user-visible strings go through gettext (`_()`, `ngettext()`). `core/` receives a translate
  function instead of importing one.
- Numbers, sizes and dates are formatted with the user's locale (`Intl`).
- Every icon-only button sets `accessible_name`. Everything in the menu is reachable by keyboard
  (PopupMenu provides this; do not break it).
- Never use colour alone to convey state: the status dot is paired with an accessible label.

## 9. Compatibility

See [COMPATIBILITY.md](COMPATIBILITY.md). The typings come from GNOME 50 (`@girs/gnome-shell`).
**Typings compiling is not proof that an API exists on GNOME 46.** Every Shell API used must
appear in the compatibility table, with the oldest version verified.

## 10. Definition of done

A change is done when:

1. Tests were written first and failed for the right reason ([TESTING.md](TESTING.md#tdd-cycle)).
2. `make check` passes (format, lint, types, unit tests with coverage thresholds, icons, tooling tests).
3. `make test-gjs` passes if `adapters/` changed. Before release, `make incus-ci-all` passes.
4. The adversarial review ([AGENT_WORKFLOW.md](AGENT_WORKFLOW.md)) has no open blocker or major
   findings.
5. Docs, ADRs, `CHANGELOG.md` (Unreleased) and the ROADMAP task status are updated in the same
   merge request.
6. A UI change was exercised in a nested shell on GNOME 50, and on GNOME 46 before release.
