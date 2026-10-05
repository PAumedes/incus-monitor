---
name: release
description: Prepares and verifies a release - changelog preview from commits, clean-container CI on both Ubuntu series, package inspection, self-review checklist. Use when asked to prepare, check or cut a release. Never runs `make release`, tags, pushes or uploads.
---

# Release preparation

Follow `docs/RELEASING.md`. As the agent, you **prepare and verify**. The maintainer runs
`make release`, pushes, and uploads to the PPA.

1. Confirm that the milestone's ROADMAP tasks are `done`. List anything still open.
2. Run `make changelog-preview`. Flag commit subjects that would read badly in the changelog
   (vague, internal jargon, typos) and suggest rewordings. Check that the proposed SemVer bump
   matches the actual impact (for example, a `fix:` that removes a setting is a major change).
3. Run `make incus-ci-all`. Both series must pass.
4. Inspect the artifacts in `build/incus-24.04/`:
   - `unzip -l *.zip` and `dpkg -c *.deb` against the self-check list in RELEASING.md
   - `dpkg -I *.deb`: version, dependencies, description
5. Spawn `reviewer-gnome` on `dist/` for an independent read of the shipped JavaScript.
6. Produce the manual-matrix checklist (`docs/TESTING.md#manual-matrix`) for the maintainer to
   run in the VMs (`make vm RELEASE=24.04|26.04`).
7. Report: the proposed version, the changelog preview, the artifact listings, the reviewer
   verdict, and the exact remaining commands for the maintainer (`make release …`,
   `git push origin main vX.Y.Z`, the PPA steps).
