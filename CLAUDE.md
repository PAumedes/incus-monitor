# CLAUDE.md

Incus Monitor: a GNOME Shell 46–50 extension (TypeScript) that monitors and controls local Incus
6.0/7.0 instances over the unix socket. Open source, GPL-2.0-or-later, targeting
extensions.gnome.org.

## Read before working

- Architecture and layer rules: @docs/ARCHITECTURE.md
- Engineering rules and definition of done: @docs/ENGINEERING.md
- The task you're on: `docs/ROADMAP.md` (acceptance criteria per task)
- Topic docs, as needed: `docs/TESTING.md`, `docs/CODE_STYLE.md`, `docs/UI_DESIGN.md`,
  `docs/INCUS_API.md`, `docs/COMPATIBILITY.md`, `docs/adr/`

## Commands

```sh
make                   # list targets
npm test -- <file>     # unit tests (Vitest) in the TDD loop
make check             # format+lint+types+coverage+icons+tooling tests: must pass before review
make test-gjs          # adapters under GJS
make incus-ci          # full CI in a clean Ubuntu container (RELEASE=24.04|26.04)
make build | zip | deb # dist/, zip, .deb (deb on the host: make incus-package)
```

## Non-negotiables

- **TDD.** Failing test first, and confirm it fails for the right reason. Never weaken a test to
  go green.
- **`src/core/` is pure.** No `gi://`, `resource://` or GJS globals. Lint enforces it; don't
  disable the rule.
- **Lifecycle.** Everything created in `enable()` is destroyed in `disable()`: widgets, signals,
  sources, cancellables.
- **No sync I/O in the shell process.** No new runtime dependencies. No dev dependency changes
  without the maintainer.
- **Compatibility.** Any Shell API you use must be listed in `docs/COMPATIBILITY.md` and exist on
  GNOME 46. The @girs typings are for 50 and will not catch this.
- **Icons.** Adwaita symbolic names from `docs/UI_DESIGN.md#icons` only.
- **Comments explain why.** No prompt-like or AI-addressed text anywhere: EGO rejects it.
- **Refactoring** follows the `refactoring` skill (Fowler): separate from behaviour changes, in
  small named steps under green tests.
- **Never** commit, push, tag, run `make release`, or edit CI, lint or tsconfig settings or
  coverage thresholds unless explicitly asked.

## Multi-agent workflow

Use the `implement-task` skill (`/implement-task T02`). It runs `test-author` → `implementer` →
parallel adversarial reviewers → triage → fix loop. See `docs/AGENT_WORKFLOW.md`. Agents live in
`.claude/agents/`, procedures in `.claude/skills/`.

## Environment notes

- The dev host is Ubuntu 26.04 (GNOME 50, Incus 6.0.5). The user is in the `incus` group, so the
  socket is `/var/lib/incus/unix.socket.user` and the project is `user-<uid>`.
- Probe the API read-only with
  `curl -s --unix-socket /var/lib/incus/unix.socket.user 'http://incus/1.0/instances?all-projects=true&recursion=1'`.
  Never change the state of the user's instances while testing; use the fake server or a
  throwaway instance you created yourself.
