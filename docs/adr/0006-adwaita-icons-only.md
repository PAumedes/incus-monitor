# ADR-0006: Adwaita symbolic icons only

- Status: Accepted
- Date: 2026-10-04

## Context

The panel and menu need icons. The EGO guidelines forbid including brand names, logos or artwork
without express permission. The Incus logo belongs to the Linux Containers project. Symbolic
icons from the user's theme recolour correctly in light, dark and high-contrast styles.

## Decision

Use only stock Adwaita symbolic icons by name, outside the deprecated `legacy/` context, from the
set in [UI_DESIGN.md](../UI_DESIGN.md#icons). Ship no icon files. `scripts/check-icons.sh`
verifies every icon name used in `src/` against the installed theme, and CI runs it on Ubuntu
24.04 and 26.04.

## Consequences

- Zero artwork to license or maintain, and perfect theme integration.
- The panel icon (`package-x-generic-symbolic`) is generic. If the Linux Containers project
  grants permission for a symbolic Incus mark, a new ADR can supersede this one.

## Alternatives considered

- **Bundled Incus logo**: needs permission, and is not symbolic.
- **Custom drawn symbolic icon**: more artwork to maintain, and inconsistent with the theme over
  time.
