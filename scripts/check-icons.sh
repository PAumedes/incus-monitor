#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Verify that every symbolic icon name used in src/ ships with the installed
# Adwaita icon theme, outside the deprecated legacy/ context.
# CI runs this on each supported Ubuntu image, so every target theme is covered.
set -euo pipefail
cd "$(dirname "$0")/.."

theme=${ICON_THEME_DIR:-/usr/share/icons/Adwaita/symbolic}
if [[ ! -d $theme ]]; then
    if [[ -n ${CI:-} ]]; then
        echo "Icon theme not found at $theme" >&2
        exit 1
    fi
    echo "Skipping: icon theme not found at $theme" >&2
    exit 0
fi

mapfile -t icons < <(grep -rhoE "'[a-z0-9-]+-symbolic'" src | tr -d "'" | sort -u)

missing=0
for icon in "${icons[@]}"; do
    path=$(find "$theme" -path "$theme/legacy" -prune -o -name "$icon.svg" -print -quit)
    if [[ -z $path ]]; then
        echo "missing or legacy-only icon: $icon" >&2
        missing=1
    fi
done

echo "Checked ${#icons[@]} icon(s) against $theme"
exit "$missing"
