# ADR-0010: Distribution as a .deb, with a private PPA for production

- Status: Accepted
- Date: 2026-10-04

## Context

GNOME extensions are usually installed per user from extensions.gnome.org (EGO). The maintainer
wants managed, system-wide installs through apt from a private Launchpad PPA in production, and
simple `.deb` or zip files during development. Launchpad builders have no network access, and
the Node/TypeScript toolchain is not in the Ubuntu archive at the required versions. The
extension is plain JavaScript and data, so it has no architecture- or series-specific content.

## Decision

- `make build` produces `dist/`, the single source for every format.
- **Zip** (`make zip`): for per-user installs, testing, and EGO if we ever publish there.
- **.deb** (`make deb`, or `make incus-package` on the host): package
  `gnome-shell-extension-incus-monitor`, `Architecture: all`, installing to
  `/usr/share/gnome-shell/extensions/<uuid>/`, with schemas in `/usr/share/glib-2.0/schemas/`
  and translations in `/usr/share/locale/`. One `.deb` serves every supported series. It is
  attached to each GitHub release for development and testing.
- **PPA** (`make ppa-source SERIES=noble|resolute`): a `3.0 (native)` source package that
  **includes the prebuilt `dist/`**, because Launchpad cannot run the Node toolchain. Each series
  gets a version suffix (`1.2.0~24.04.1`, `1.2.0~26.04.1`), because Launchpad requires a unique
  version per series. The content is identical.

## Consequences

- One build artifact for all Ubuntu releases. "One build per Ubuntu" applies only to the PPA
  upload, and only to the version number.
- The PPA source package is not built from the TypeScript sources. This is acceptable for a
  private PPA. The shipped JavaScript is the readable `tsc` output, and the full source lives in
  the repository. The Ubuntu archive or Debian proper would need a different approach (vendoring
  the toolchain).
- A per-user install (zip or EGO) takes precedence over the system-wide `.deb`. Testers must
  `make uninstall` the zip when testing the `.deb`.

## Alternatives considered

- **EGO only**: the standard channel, but not apt-managed, which the maintainer wants for
  production.
- **Building TypeScript on Launchpad**: impossible without network access or archive packages for
  the toolchain.
- **One build per Ubuntu series**: no technical reason, because the payload is identical.
