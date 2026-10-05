# ADR-0011: Releases and changelogs generated from Conventional Commits

- Status: Accepted
- Date: 2026-10-04

## Context

Each release must record its changes in a release file, and the Debian package needs its own
changelog. Hand-maintained changelogs drift and conflict between branches. Commits already follow
Conventional Commits, enforced by the `commit-msg` hook.

## Decision

- `make release` (`scripts/release.py`) collects every non-merge commit since the previous tag,
  groups them by type (breaking changes first), and writes:
  - a new section in `CHANGELOG.md`
  - a new entry in `debian/changelog`
  - the new version in `package.json` and `package-lock.json`

  It then creates a `chore(release): vX.Y.Z` commit and an annotated tag `vX.Y.Z` locally. The
  maintainer reviews and pushes; the push triggers the hosted release workflow.

- Versions follow SemVer. `BUMP=auto` derives the bump from the commits (breaking → major, or
  minor while in 0.x; `feat` → minor; anything else → patch). Pre-releases
  (`NEW_VERSION=1.0.0-rc.1`) become GitHub pre-releases and Debian `~rc.1` versions.
- Release notes for GitHub and GitLab are extracted from `CHANGELOG.md`
  (`scripts/release.py --notes vX.Y.Z`). There is one source of truth.
- Released sections are never edited by hand. Commit subjects are written for users.

## Consequences

- No changelog merge conflicts, and every change appears in the release record.
- Commit discipline matters: a sloppy subject ends up in the changelog. Squash or reword before
  merging.
- The tool is about 200 lines of standard-library Python with unit tests
  (`scripts/tests/test_release.py`).

## Alternatives considered

- **git-cliff or semantic-release**: capable, but an extra toolchain dependency for a small
  amount of logic.
- **Changelog fragment files**: no conflicts, but a manual extra step per change, which the
  maintainer declined.
