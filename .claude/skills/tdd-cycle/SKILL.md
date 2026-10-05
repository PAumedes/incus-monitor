---
name: tdd-cycle
description: The red-green-refactor procedure and test conventions for this repo (Vitest for src/core, GJS harness for src/adapters, fixtures, fakes, builders). Use whenever writing or changing tests or production code here.
---

# TDD cycle

The full policy is in `docs/TESTING.md`. This is the operational checklist.

## Loop

```text
1. Pick the next smallest behaviour from the acceptance criteria.
2. RED       write one test → npm test -- <file>  → fails for the expected reason?  (else fix the test)
3. GREEN     least code that passes → npm test -- <file>
4. REFACTOR  load the `refactoring` skill: name the smell, apply named refactorings in small
             steps → npm test after each (all green)
5. Repeat. Before handing off: make check
```

## Where tests go

| Code under test           | Test file                            | Runner          |
| ------------------------- | ------------------------------------ | --------------- |
| `src/core/<path>.ts`      | `tests/unit/core/<path>.test.ts`     | `npm test`      |
| Decoders against fixtures | `tests/unit/contract/<name>.test.ts` | `npm test`      |
| `src/adapters/<name>.ts`  | `tests/gjs/<name>.test.ts`           | `make test-gjs` |
| Repository invariants     | `tests/unit/<name>.test.ts`          | `npm test`      |

## Conventions

- Vitest: `import { describe, expect, it } from 'vitest';`. Use `it.each` for tables. No
  `vi.mock` of our own modules: inject fakes through ports instead.
- Fakes live in `tests/unit/fakes/` (`FakeClock`, `FakeTransport`, `FakeFileProbe`). Create a
  fake when the first test needs it, and keep it minimal.
- Builders in `tests/unit/builders.ts` start from a recorded fixture object and override only the
  fields under test: `anInstance({ status_code: 110 })`.
- Load fixtures with a helper that returns the recorded `{ request, http_status, body }`.
- GJS tests: `import { test, assert } from './harness.js';`. Every test cleans up its sockets
  and sources, even on failure (`try/finally`).
- Never `setTimeout`, sleep or real time in unit tests. Advance a `FakeClock`.
- Test names read as specifications: `'returns null CPU usage on the first sample'`.

## Red-flag checks before handing off

- Could this test pass with a wrong implementation? Mutate the code mentally: flip a comparison,
  drop a branch. Would a test fail?
- Does any test depend on execution order or on the host (locale, timezone, Incus installed)?
  Pin locale and timezone explicitly.
- Coverage below 95 % on a touched core file means a branch is unspecified. Add the test; do not
  argue the number.
