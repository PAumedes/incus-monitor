# ADR-0009: Incus for reproducible local builds and test VMs

- Status: Accepted
- Date: 2026-10-04

## Context

Builds and tests must behave the same on a developer's machine as in CI, on both supported
Ubuntu series (24.04 and 26.04). The developer host is a single Ubuntu release with its own
toolchain. GNOME 46 cannot be tested on a 26.04 host without a separate desktop. Hosted CI
(GitHub Actions now, self-hosted GitLab later) runs Docker images.

## Decision

- One provisioning script, `scripts/ci/provision.sh`, prepares a clean Ubuntu for the build.
  Every environment runs it, then `make ci`.
- **Locally, Incus**: `make incus-ci RELEASE=24.04|26.04` runs `make ci` in an ephemeral system
  container launched from a cached, provisioned image (`scripts/incus-run.sh`). The image is
  rebuilt automatically when the provisioning script or `.nvmrc` changes.
- **Desktop testing, Incus VMs**: `make vm RELEASE=…` boots `images:ubuntu/<release>/desktop`
  with Incus and the built `.deb` installed.
- **Hosted CI, Docker** `ubuntu:<release>` images, running the same two commands.

## Consequences

- One definition of "the build". Pipeline files are thin wrappers that cannot drift.
- Incus is already a hard requirement to use the extension, so it adds nothing new for
  contributors. Docker is only needed by the CI services.
- The first local run builds the base image (a few minutes); later runs start in seconds.

## Alternatives considered

- **Docker locally**: matches CI images exactly, but cannot boot a GNOME desktop for 46 testing,
  so contributors would need two tools.
- **Host toolchain only**: fast, but builds and tests only on the host's Ubuntu release.
