# ADR-0005: Ports and adapters with a pure, lint-enforced core

- Status: Accepted
- Date: 2026-10-04

## Context

GNOME Shell code is hard to test: it needs a compositor, and the lifecycle mistakes that matter
most (leaks after `disable()`) only show up at runtime. Most of this extension's logic (HTTP
framing, decoding, metrics, scheduling, presentation) does not need GNOME at all.

## Decision

- `src/core/` is pure TypeScript with no `gi://` or `resource://` imports and no GJS globals. It
  runs under Node and is unit-tested to ≥95 % branch coverage.
- `src/core/ports.ts` defines the interfaces `Transport`, `Clock`, `FileProbe`, `Launcher` and
  `Clipboard`. `src/adapters/` implements them with Gio/GLib/St and stays thin.
- `src/ui/` renders view models produced by `core/presenter.ts` and forwards user intents. It
  holds no business logic.
- `src/extension.ts` is the only place that knows every layer.
- ESLint `no-restricted-imports` per directory enforces the dependency direction.

## Consequences

- Fast, deterministic tests for nearly all logic.
- Some indirection: one interface per external capability. Ports are added only when an adapter
  needs one, never speculatively.

## Alternatives considered

- **Classic GNOME extension layout** (logic inside widgets, as Vitals does): fewer files, but
  untestable without a running Shell.
