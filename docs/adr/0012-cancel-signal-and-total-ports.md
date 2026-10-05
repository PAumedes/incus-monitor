# ADR-0012: Core cancellation signal and ports that never reject

- Status: Accepted
- Date: 2026-10-05

## Context

ENGINEERING §4 requires every async operation to honour cancellation, because `disable()` can
run while I/O is in flight. The core runs under Node (tests) and GJS (the shell). GJS provides
neither `AbortController` nor `AbortSignal`: `gjs -c 'print(typeof AbortController)'` prints
`undefined` on GJS 1.88 (GNOME 50), and older releases such as GJS 1.80 (GNOME 46) do not add it
either. The adapters cancel GIO work with `Gio.Cancellable`, which the core must not import.

A port that may reject forces every core caller to catch. The easy catch-all turns adapter bugs
into user-facing states, such as "Incus is not installed", which hides them.

## Decision

- `core/cancel.ts` defines a minimal, pure `CancelSignal`
  (`cancelled`, `onCancel(callback) → unsubscribe`) and a `CancelSource` that owns one. Every
  async port method and core operation takes a `CancelSignal`. Adapters bridge it to a
  `Gio.Cancellable`.
- After every `await`, core code checks `signal.cancelled` and returns
  `err({ kind: 'cancelled' })` without touching further state, using `isCancelled(signal)`
  so that TypeScript does not keep a narrowed `false` across the `await`. Cancellation is a
  value, like every other failure.
- `cancel()` runs every registered callback even if one throws, then rethrows the first error,
  so a faulty adapter cannot stop the rest of a `disable()` teardown.
- **Ports are total:** they resolve, never reject. Each adapter maps every platform failure to a
  value of the port's result type, and owns logging of unexpected errors. Core code does not
  wrap port calls in `try`/`catch`, with one exception: the monitor's two entry points
  (the polling cycle and `perform`) and the `onSnapshot` consumer callback are guarded and
  logged once per failure episode, so a contract-breaking port or consumer cannot wedge polling
  or leave an unhandled rejection. `Clock` and the log are total ports and are not wrapped.
  Everything else stays unwrapped.

## Consequences

- One cancellation convention for every port (socket probe, transport, clock), testable under
  Node with a plain `CancelSource`.
- Adapter tests (GJS) carry the burden of error mapping, which is where the platform knowledge
  lives.
- A port that throws anyway is a programmer error and surfaces loudly, instead of being
  disguised as a user-facing state.

## Alternatives considered

- **Global `AbortController`:** not available in GJS. A polyfill would be more code than this
  module.
- **`Gio.Cancellable` in core types:** breaks core purity (ADR-0005).
- **Disposed flags only:** prevents use-after-dispose, but cannot stop in-flight GIO work.
