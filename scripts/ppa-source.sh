#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Build a signed source package for one Ubuntu series, ready for `dput` to a Launchpad PPA.
# Launchpad needs a distinct version per series, so the staging copy gets an extra changelog
# entry "<version>~<release>.1" targeting that series. The repository is not modified.
#
# usage: scripts/ppa-source.sh <noble|resolute>
# needs: debhelper and a GPG key registered on Launchpad (DEBSIGN_KEYID selects it).
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/ui.sh

declare -A releases=([noble]=24.04 [resolute]=26.04)
series=${1:-}
[[ -n ${releases[$series]:-} ]] || { ui_fail "usage: $0 <${!releases[*]}>"; exit 2; }
[[ -f dist/metadata.json ]] || { ui_fail "dist/ is missing: run 'make build' first"; exit 1; }

base=$(dpkg-parsechangelog --show-field Version)
version="$base~${releases[$series]}.1"
maintainer=$(dpkg-parsechangelog --show-field Maintainer)

staging=$(mktemp -d)
mkdir "$staging/src"
cp -r debian dist data LICENSE "$staging/src/"

{
    printf '%s (%s) %s; urgency=medium\n\n' "$(dpkg-parsechangelog --show-field Source)" "$version" "$series"
    printf '  * Build for Ubuntu %s (%s).\n\n' "${releases[$series]}" "$series"
    printf ' -- %s  %s\n\n' "$maintainer" "$(date -R)"
    cat debian/changelog
} >"$staging/src/debian/changelog"

sign=()
[[ -n ${DEBSIGN_KEYID:-} ]] && sign=(--sign-key="$DEBSIGN_KEYID")
(cd "$staging/src" && dpkg-buildpackage --build=source -sa "${sign[@]}")

mkdir -p build/ppa
mv "$staging"/*.{dsc,tar.*,buildinfo,changes} build/ppa/
rm -rf "$staging"

ui_ok "Source package: build/ppa/"
ui_info "Upload with: dput ppa:<owner>/<ppa> build/ppa/*_${version}_source.changes"
