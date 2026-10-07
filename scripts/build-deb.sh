#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Build the binary .deb from dist/ in a clean staging tree, so the repository is never touched
# by dpkg-buildpackage. The package is Architecture: all; one .deb serves 24.04 and 26.04.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/ui.sh

for tool in dpkg-parsechangelog dpkg-buildpackage dh lintian; do
    command -v "$tool" >/dev/null || { ui_fail "$tool not found: run 'make doctor' for the packages to install"; exit 1; }
done
[[ -f dist/metadata.json ]] || { ui_fail "dist/ is missing: run 'make build' first"; exit 1; }

version=$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')
deb_version=$(dpkg-parsechangelog --show-field Version)
if [[ ${deb_version} != "${version/-/\~}" ]]; then
    ui_fail "debian/changelog ($deb_version) does not match package.json ($version)."
    ui_fail "Releases update both: use 'make release'."
    exit 1
fi

staging=$(mktemp -d)
trap 'rm -rf "$staging"' EXIT
mkdir "$staging/src"
cp -r debian dist data LICENSE "$staging/src/"

(cd "$staging/src" && dpkg-buildpackage --build=binary --no-sign)
lintian --fail-on error,warning --suppress-tags no-manual-page "$staging"/*.deb

mkdir -p build
mv "$staging"/*.deb build/
ui_ok "Built $(echo build/*.deb)"
