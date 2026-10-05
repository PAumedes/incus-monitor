# Releasing and distribution

Decisions: [ADR-0010](adr/0010-distribution-deb-and-ppa.md) (packaging),
[ADR-0011](adr/0011-release-from-conventional-commits.md) (versions and changelog).

## One build for every Ubuntu release

The extension is JavaScript plus data, with nothing compiled per architecture or per series.
`make build` produces `dist/`, and every package format is made from it:

| Artifact                                                | Command                                           | Installs to                                                | Used for                                                  |
| ------------------------------------------------------- | ------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------- |
| `build/<uuid>.shell-extension.zip`                      | `make zip`                                        | `~/.local/share/gnome-shell/extensions/<uuid>/` (per user) | Development, testers, EGO (optional)                      |
| `build/gnome-shell-extension-incus-monitor_<v>_all.deb` | `make deb` (in a container: `make incus-package`) | `/usr/share/gnome-shell/extensions/<uuid>/` (system)       | Development and testing; attached to every GitHub release |
| PPA source package, per series                          | `make ppa-source SERIES=noble\|resolute`          | via apt                                                    | Production (private Launchpad PPA)                        |

The same `.deb` installs on 24.04 and 26.04. The PPA needs one upload per series only because
Launchpad requires distinct version strings (`1.2.0~24.04.1`, `1.2.0~26.04.1`). The content is
identical.

A per-user install shadows the system one. When testing the `.deb`, run `make uninstall` first.

## Branching and versioning

- **Trunk-based**: `main` is always releasable. Short-lived feature branches merge through
  reviewed merge or pull requests. No long-lived release branches; if a fix must go to an older
  release, branch `release/X.Y` from its tag at that time.
- **SemVer** on user-visible behaviour:
  - **major**: dropped GNOME or Incus series, removed settings, behaviour users rely on changes
  - **minor**: new features, newly supported GNOME or Incus series
  - **patch**: fixes only
- **Pre-releases** `X.Y.Z-rc.N` for testers. They are GitHub pre-releases and never go to the
  production PPA.
- Tags `vX.Y.Z` are created only by `make release`.

## Changes record

There is nothing to edit by hand during development. Write good
[Conventional Commit](https://www.conventionalcommits.org/) subjects (the `commit-msg` hook
enforces the format). At release time, `make release` writes **every commit since the previous
tag**, grouped by type, into:

- `CHANGELOG.md`, the human-readable release file, also used as the GitHub/GitLab release notes
- `debian/changelog`, the package changelog shown by `apt changelog`

`make changelog-preview` shows what the next release will contain.

## Cutting a release

1. Make sure ROADMAP tasks for the milestone are `done` and `main` is green in CI.
2. `make changelog-preview`: read it as a user would. Reword bad commit subjects before release
   if needed (squash or reword on a branch).
3. Run the full matrix in clean containers: `make incus-ci-all`.
4. Run the manual checklist ([TESTING.md](TESTING.md#manual-matrix)) in the VMs:
   `make incus-package RELEASE=24.04 && make vm RELEASE=24.04`, then the same for 26.04.
5. `make release` (or `BUMP=minor`, or `NEW_VERSION=1.0.0-rc.1`). This commits and tags locally.
6. Review with `git show`, then push: `git push origin main vX.Y.Z`.
7. CI builds from the tag and creates the GitHub release with the zip, the `.deb` and the notes.
8. Production only: build and upload the PPA sources for each series:

   ```sh
   make ppa-source SERIES=noble    && dput ppa:<owner>/<ppa> build/ppa/*~24.04.1_source.changes
   make ppa-source SERIES=resolute && dput ppa:<owner>/<ppa> build/ppa/*~26.04.1_source.changes
   ```

   This needs `debhelper`, `dput` and the GPG key registered on Launchpad (`DEBSIGN_KEYID`).
   Private PPAs require a Launchpad subscription for each consuming machine.

## Release self-check

- [ ] `unzip -l build/*.zip`: only JS, `metadata.json`, `stylesheet.css`, `schemas/*.gschema.xml`
      and `locale/`. No `gschemas.compiled`, no maps, no tests.
- [ ] `dpkg -c build/*.deb`: extension under `/usr/share/gnome-shell/extensions/<uuid>/`, schema
      under `/usr/share/glib-2.0/schemas/`, no `schemas/` directory inside the extension.
- [ ] lintian clean (run by `make deb`).
- [ ] Read the shipped JS once as a reviewer would: formatted, no dead code, no AI-style comments.
- [ ] Nothing happens before `enable()`, and everything is undone in `disable()`.
- [ ] No GTK in the shell process; no Shell libraries in prefs; no `console.log`.
- [ ] `metadata.json`: no `version`, no `session-modes`; clipboard use declared.

## Publishing on extensions.gnome.org (optional)

The zip is EGO-ready. If public distribution through EGO is ever wanted, upload the release zip
(`gnome-extensions upload` on GNOME 49+, or the web form), and record the EGO version number next
to the release in `CHANGELOG.md`.
