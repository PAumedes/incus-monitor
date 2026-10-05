# ADR-0007: Support Incus 6.0 LTS and 7.0 LTS by feature detection

- Status: Accepted
- Date: 2026-10-04

## Context

Incus versions so far: 0.x (2023–2024), 6.0 LTS (2024, supported to 2029), 6.x monthly feature
releases, and 7.0 LTS (2026, supported to 2031). Ubuntu 24.04's universe ships 0.6, and 26.04
ships 6.0.x. The REST API is versioned `1.0` and grows through named `api_extensions`.

## Decision

Support the 6.0 and 7.0 LTS series. Gate at runtime on the required `api_extensions`
([INCUS_API.md](../INCUS_API.md#compatibility-gate)), not on version strings. Servers that
lack them get a clear "unsupported" state.

## Consequences

- Feature releases (6.x, 7.x) work as long as the extensions exist.
- Ubuntu 24.04 users need Incus from the Zabbly repository. Document this in the README.
- Recorded fixtures for each LTS series keep the decoders honest.

## Alternatives considered

- **Version-string checks**: brittle across distro patch versions and backports.
- **Supporting 0.6**: an old, unmaintained API surface, for little benefit.
