# ADR-0008: Vitest for core, GJS harness for adapters

- Status: Accepted
- Date: 2026-10-04

## Context

The core is pure TypeScript and can run under Node. The adapters need GLib's main loop and real
Gio sockets, which only exist under GJS. Jasmine-GJS is not packaged for Ubuntu.

## Decision

- **Vitest** (Node) for `src/core/` and repository invariants, with v8 coverage thresholds.
- A **minimal GJS harness** (`tests/gjs/harness.ts`, about 70 lines: `test`, `assert`, sequential
  async runner) for `src/adapters/`. Tests compile with `tsconfig.gjs.json` and run with
  `gjs -m`.
- No automated UI tests. UI is verified by the manual matrix in
  [TESTING.md](../TESTING.md#manual-matrix), kept short because the UI holds no logic.

## Consequences

- Fast feedback for most changes. GJS tests run in CI on Ubuntu 24.04 (GJS 1.80) and 26.04 (GJS 1.88).
- We maintain a tiny harness. It is deliberately minimal; if it grows past about 150 lines,
  reconsider.

## Alternatives considered

- **Jasmine-GJS**: not packaged; vendoring it adds code we don't own.
- **Running everything under GJS**: slower, and loses the Vitest ecosystem (watch mode, coverage).
