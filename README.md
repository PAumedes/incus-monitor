# Incus Monitor

A GNOME Shell extension that puts your local [Incus](https://linuxcontainers.org/incus/)
containers and virtual machines in the top bar: what's running, how much it uses, and one
click to start, stop, restart, freeze or open a shell.

> **Status:** pre-release. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Features

- Running-instance count in the panel
- Containers and VMs across every project you can access
- Live CPU, memory and network usage while the menu is open
- Start, stop, restart, freeze or unfreeze an instance
- Open a shell (or a console for VMs without an agent) in your terminal
- Copy an instance's address
- Nothing else. On purpose.

## Requirements

|             | Supported                                                                    |
| ----------- | ---------------------------------------------------------------------------- |
| GNOME Shell | 46, 47, 48, 49, 50 (Ubuntu 24.04 LTS, 26.04 LTS)                             |
| Incus       | 6.0 LTS, 7.0 LTS (and feature releases in between)                           |
| Access      | Your user in the `incus` group (own project) or `incus-admin` (all projects) |

On Ubuntu 24.04, the archive's Incus 0.6 is too old. Install Incus from the
[Zabbly repository](https://github.com/zabbly/incus) instead.

## Install

- **apt (production)**: from the project's PPA, once published.
- **.deb (testing)**: download it from a release, then
  `sudo apt install ./gnome-shell-extension-incus-monitor_<version>_all.deb`.
- **From source (per user)**:

  ```sh
  make install
  ```

Then log out and back in, and enable the extension with Extension Manager or
`gnome-extensions enable incus-monitor@patricioaumedes`.

## Privacy

The extension talks only to the local Incus unix socket. It sends no data anywhere. It writes to
the clipboard only when you press the copy button next to an address.

## Contributing

Start with [CONTRIBUTING.md](CONTRIBUTING.md). Design and engineering documents live in
[`docs/`](docs/):

- [Architecture](docs/ARCHITECTURE.md) · [Engineering principles](docs/ENGINEERING.md) ·
  [Code style](docs/CODE_STYLE.md) · [Testing and TDD](docs/TESTING.md)
- [UI design](docs/UI_DESIGN.md) · [Incus API notes](docs/INCUS_API.md) ·
  [Compatibility](docs/COMPATIBILITY.md) · [Releasing](docs/RELEASING.md)
- [Decision records](docs/adr/README.md) · [Agent workflow](docs/AGENT_WORKFLOW.md)

## License

[GPL-2.0-or-later](LICENSE). Incus is a trademark of its respective owners; this project is not
affiliated with the Linux Containers project.
