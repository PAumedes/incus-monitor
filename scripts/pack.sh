#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Zip dist/ into the extension bundle accepted by `gnome-extensions install` and EGO.
# One bundle serves every supported GNOME version (46–50).
set -euo pipefail
cd "$(dirname "$0")/.."

[[ -f dist/metadata.json ]] || { echo "dist/ is missing: run 'make build' first" >&2; exit 1; }

uuid=$(python3 -c 'import json; print(json.load(open("dist/metadata.json"))["uuid"])')
zip="$PWD/build/$uuid.shell-extension.zip"

mkdir -p build
rm -f "$zip"
(cd dist && zip --quiet --recurse-paths -X "$zip" .)

echo "Packed $zip"
