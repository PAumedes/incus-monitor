# Code style

Tooling settles formatting: **Prettier** (`.prettierrc.json`) and **ESLint** with
`typescript-eslint` `strictTypeChecked` (`eslint.config.js`). This document covers what tools
cannot decide.

## Files

- Every source file starts with `// SPDX-License-Identifier: GPL-2.0-or-later`.
- Filenames are `kebab-case.ts`. One primary export per module. Tests mirror the source path:
  `src/core/http/response.ts` → `tests/unit/core/http/response.test.ts`.
- Imports carry the `.js` extension (NodeNext resolution): `import { x } from './result.js';`.
- Order: `gi://` imports, then `resource://` imports, then relative imports, separated by blank lines.

## Naming

| Kind                  | Style                                                              | Example                        |
| --------------------- | ------------------------------------------------------------------ | ------------------------------ |
| Types, classes        | PascalCase                                                         | `InstanceState`, `IncusClient` |
| Functions, variables  | camelCase                                                          | `decodeInstance`, `cpuPercent` |
| Module constants      | UPPER_CASE                                                         | `REQUEST_TIMEOUT_MS`           |
| Private class members | `#private` field                                                   | `#cancellable`                 |
| GObject subclasses    | `GObject.registerClass` with a `GTypeName` prefixed `IncusMonitor` |                                |

Units go in names when they are not obvious: `timeoutMs`, `usageNs`, `bytesPerSecond`.

## Types

- Prefer `type` aliases for unions and data, `interface` for ports implemented by adapters.
- Use string-literal unions, not `enum` (lint-enforced).
- Domain objects are `readonly` and created by decoders or factory functions, never by object
  literals scattered around.
- Do not export types "just in case".

## Functions

- Small, pure, and named for what they return (`runningCount(instances)`), not how they work.
- At most 3 positional parameters. Beyond that, pass an options object.
- Early returns over nested conditionals.

## Comments

- Explain **why**, never **what**. If code needs a "what" comment, rename or extract instead.
- Document Incus or GNOME quirks where they are handled, with a link. Example:
  `// Incus returns HTTP 500 (not 403) for a forbidden project: see docs/INCUS_API.md#quirks`.
- TSDoc (`/** … */`) only on exported port interfaces and non-obvious public functions.
- No commented-out code, no TODOs without an issue reference (`// TODO(#12): …`), and no text
  addressed to an AI or a reviewer.

## GNOME Shell specifics

- Use `this.getSettings()`, `this.path` and `this.metadata` from the `Extension` instance, and pass
  them down. Never reach for globals from inside `ui/`.
- Use `connectObject(…, this)` / `disconnectObject(this)` for signals tied to an actor's lifetime.
- Use CSS classes (prefixed `incus-monitor-`) instead of inline `style` strings.
- Use `GLib.PRIORITY_DEFAULT_IDLE` for work that can wait. Never use `Mainloop`, `Lang` or
  `ByteArray` (deprecated; use `TextDecoder`/`TextEncoder`).

## Formatting of shipped JavaScript

`scripts/build.sh` runs Prettier over `dist/` so that the code EGO reviewers read is formatted
like our sources. Never ship minified or bundled output.
