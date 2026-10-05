# ADR-0001: Support GNOME 46–50 with ES modules only

- Status: Accepted
- Date: 2026-10-04

## Context

The target hosts were Ubuntu 22.04 (GNOME 42), 24.04 (GNOME 46) and 26.04 (GNOME 50). GNOME 45
replaced the legacy `imports.*` extension system with ES modules and a class-based `Extension`
API. GNOME 42 also uses libsoup 2 and an older GJS. Supporting 42 would mean either a second
codebase or a build-time transformation of every Shell import, plus a separate EGO upload and
a separate test matrix.

## Decision

Support GNOME 46 through 50 only (Ubuntu 24.04 and 26.04). `metadata.json` declares
`["46", "47", "48", "49", "50"]`. Drop Ubuntu 22.04.

## Consequences

- One codebase, one bundle, one test matrix.
- Ubuntu 22.04 users cannot install the extension. That release leaves standard support in
  April 2027.
- GNOME 45 (Ubuntu 23.10, end of life) could be added for free, but it is not a test target, so
  we do not claim it.

## Alternatives considered

- **Shared core, two build targets (ESM + legacy)**: a lot of permanent complexity for a release
  that is near end of life.
- **Separate legacy branch**: duplicated maintenance and inevitable drift.
