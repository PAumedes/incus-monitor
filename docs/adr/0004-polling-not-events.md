# ADR-0004: Adaptive polling instead of the events websocket

- Status: Accepted
- Date: 2026-10-04

## Context

Incus pushes lifecycle events over a websocket at `/1.0/events`. Consuming it needs a websocket
client over the unix socket, reconnection logic, and still a poll for metrics (events carry no
CPU or memory data).

## Decision

Poll, adaptively:

- Menu closed: `recursion=1` every `refresh-interval` seconds (default 10). This is cheap and
  enough for states and the running count.
- Menu open: an immediate refresh, then `recursion=2` every 2 s for metrics.
- After an action: an immediate refresh.
- On failure: exponential back-off up to 60 s.

## Consequences

- Up to `refresh-interval` seconds of staleness for changes made outside the extension while the
  menu is closed. This is acceptable for a monitor.
- `recursion=2` costs a VM agent round-trip per VM, so it never runs while the menu is closed.
- A future ADR can add events behind the same `Monitor` interface without touching the UI.

## Alternatives considered

- **Events websocket**: lower latency, but significantly more code and still needs polling for
  metrics.
- **Fixed fast polling**: simple, but wastes daemon and VM-agent work while nobody is looking.
