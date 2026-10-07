#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Verify that every symbolic icon name used in src/ ships with the installed
# Adwaita icon theme, outside the deprecated legacy/ context.
# CI runs this on each supported Ubuntu image, so every target theme is covered.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/ui.sh

theme=${ICON_THEME_DIR:-/usr/share/icons/Adwaita/symbolic}
if [[ ! -d $theme ]]; then
    if [[ -n ${CI:-} ]]; then
        ui_fail "Icon theme not found at $theme"
        exit 1
    fi
    ui_warn "Skipping: icon theme not found at $theme" >&2
    exit 0
fi

mapfile -t icons < <(grep -rhoE "'[a-z0-9-]+-symbolic'" src | tr -d "'" | sort -u)

missing=0
for icon in "${icons[@]}"; do
    path=$(find "$theme" -path "$theme/legacy" -prune -o -name "$icon.svg" -print -quit)
    if [[ -z $path ]]; then
        ui_fail "missing or legacy-only icon: $icon"
        missing=1
    fi
done

if ((missing)); then
    exit 1
fi
ui_ok "Checked ${#icons[@]} icon(s) against $theme"
