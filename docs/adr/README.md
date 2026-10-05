# Architecture Decision Records

One decision per file, numbered, never deleted. To change a decision, add a new ADR that
supersedes the old one, and mark the old one `Superseded by ADR-NNNN`.
Start from [`0000-template.md`](0000-template.md).

| ADR                                                 | Title                                                       | Status   |
| --------------------------------------------------- | ----------------------------------------------------------- | -------- |
| [0001](0001-gnome-46-to-50-esm-only.md)             | Support GNOME 46–50 with ES modules only                    | Accepted |
| [0002](0002-typescript-with-girs.md)                | TypeScript compiled with tsc, typed by @girs                | Accepted |
| [0003](0003-raw-http-over-gio-unix-socket.md)       | Raw HTTP/1.1 over the Incus unix socket via Gio             | Accepted |
| [0004](0004-polling-not-events.md)                  | Adaptive polling instead of the events websocket            | Accepted |
| [0005](0005-ports-and-adapters.md)                  | Ports and adapters with a pure, lint-enforced core          | Accepted |
| [0006](0006-adwaita-icons-only.md)                  | Adwaita symbolic icons only                                 | Accepted |
| [0007](0007-incus-6-and-7-lts.md)                   | Support Incus 6.0 LTS and 7.0 LTS by feature detection      | Accepted |
| [0008](0008-two-tier-testing.md)                    | Vitest for core, GJS harness for adapters                   | Accepted |
| [0009](0009-incus-for-reproducible-local-builds.md) | Incus for reproducible local builds and test VMs            | Accepted |
| [0010](0010-distribution-deb-and-ppa.md)            | Distribution as a .deb, with a private PPA for production   | Accepted |
| [0011](0011-release-from-conventional-commits.md)   | Releases and changelogs generated from Conventional Commits | Accepted |
| [0012](0012-cancel-signal-and-total-ports.md)       | Core cancellation signal and ports that never reject        | Accepted |
