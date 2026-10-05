# Contributing

Thanks for helping. This project aims for a small, correct and boring codebase. Please read
[docs/ENGINEERING.md](docs/ENGINEERING.md) before your first merge request.

## Setup

```sh
# Ubuntu 24.04 / 26.04
sudo apt install make gjs gettext zip libglib2.0-bin   # + mutter-dev-bin (GNOME 49+), virt-viewer (VM tests)
nvm use        # Node version pinned in .nvmrc
make deps
make hooks
```

Incus is the only other requirement: clean-environment builds and desktop VMs run in it
([ADR-0009](docs/adr/0009-incus-for-reproducible-local-builds.md)).

## Everyday commands

`make` lists every target. The ones you will use most:

| Command                          | What it does                                                |
| -------------------------------- | ----------------------------------------------------------- |
| `npm run test:watch`             | Unit tests in watch mode, for the TDD loop                  |
| `make check`                     | Format, lint, types, unit coverage, icons, tooling tests    |
| `make test-gjs`                  | GJS integration tests for adapters                          |
| `make incus-ci RELEASE=24.04`    | The full CI pipeline in a clean Ubuntu container            |
| `make install` / `make nested`   | Install for your user / open a nested GNOME Shell           |
| `make incus-package` / `make vm` | Build the `.deb` in a container / boot a desktop VM with it |
| `make changelog-preview`         | What the next release's changelog will say                  |

How to test on your own machine, step by step: [docs/TESTING.md](docs/TESTING.md#testing-on-your-machine).
Logs: `make logs` (prefs: `journalctl -f -o cat /usr/bin/gjs`).

## Workflow

1. Open or pick an issue, or a task from [docs/ROADMAP.md](docs/ROADMAP.md).
2. Branch from `main`: `feat/short-name`, `fix/short-name`.
3. Work test-first ([docs/TESTING.md](docs/TESTING.md#tdd-cycle)).
4. Keep merge requests small: one task, ideally under 400 changed lines excluding fixtures.
5. Fill in the merge request template. CI must be green.
6. Refactor in separate `refactor:` commits, with no behaviour change
   ([refactoring skill](.claude/skills/refactoring/SKILL.md), after Martin Fowler's _Refactoring_).

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), enforced by `.githooks/commit-msg`:

Commit subjects become the changelog at release time (`make release`), so write them for
users.

```text
feat(core): decode instance state
fix(adapters): cancel connect on disable
docs(adr): add ADR-0009 events websocket
```

Scopes: `core`, `http`, `incus`, `adapters`, `ui`, `prefs`, `build`, `ci`, `docs`, `adr`, `i18n`.

## Reviews

Every MR gets a human review. Maintainers may also run the adversarial agent reviewers described
in [docs/AGENT_WORKFLOW.md](docs/AGENT_WORKFLOW.md). Their findings are treated like any other
review comment: verified, then fixed or answered.

## Using AI assistants

Allowed, under the same bar as any other code. You must understand and be able to defend every
line you submit. extensions.gnome.org rejects code with AI-generated tells (dead code, invented
APIs, prompt-like comments), and so do we.

## Translations

Translations are welcome once string freeze for a release is announced. See `po/`.

## Code of Conduct

This project follows the [GNOME Code of Conduct](CODE_OF_CONDUCT.md).
