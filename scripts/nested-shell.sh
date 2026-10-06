#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Start a nested GNOME Shell with this extension enabled, for manual testing without logging out.
#
# The nested session uses its own dconf database (~/.config/dconf/incus_monitor_nested), so
# enabling the extension there never changes the settings of your real session. The price is that
# it starts with default appearance, so the appearance and accessibility keys the UI depends on
# (theme, icons, cursor, accent, text scale, animations) are copied from the real session, read
# only, before the profile is switched. Keys missing from the installed schema (accent-color is
# GNOME 47+) are skipped.
# GNOME 49+ needs the mutter development kit: sudo apt install mutter-dev-bin
set -euo pipefail
cd "$(dirname "$0")/.."

uuid=$(python3 -c 'import json; print(json.load(open("data/metadata.json"))["uuid"])')
if [[ ! -d ~/.local/share/gnome-shell/extensions/$uuid ]]; then
    echo "$uuid is not installed: run 'make install' first" >&2
    exit 1
fi

major=$(gnome-shell --version | grep -oE '[0-9]+' | head -1)
if ((major >= 49)); then
    mode=--devkit
else
    mode=--nested
fi

schema=org.gnome.desktop.interface
copied=
for key in color-scheme gtk-theme icon-theme cursor-theme accent-color text-scaling-factor enable-animations; do
    if gsettings list-keys "$schema" | grep -qx "$key"; then
        copied+="$key $(gsettings get "$schema" "$key")"$'\n'
    fi
done

profile=$(mktemp)
trap 'rm -f "$profile"' EXIT
printf 'user-db:incus_monitor_nested\n' >"$profile"
export DCONF_PROFILE=$profile

# Match the real desktop: on Ubuntu the "ubuntu" session mode adds the dock, Yaru and AppIndicators.
session_mode=user
[[ -f /usr/share/gnome-shell/modes/ubuntu.json ]] && session_mode=ubuntu
export SESSION_MODE=$session_mode

export MUTTER_DEBUG_DUMMY_MODE_SPECS=${MUTTER_DEBUG_DUMMY_MODE_SPECS:-1600x1000}
export UUID=$uuid MODE=$mode SCHEMA=$schema COPIED=$copied

echo "GNOME Shell $major ($mode, $session_mode session) with $uuid enabled. Logs: this terminal."
dbus-run-session -- bash -c '
    while read -r key value; do
        [[ -n $key ]] && gsettings set "$SCHEMA" "$key" "$value"
    done <<<"$COPIED"
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell enabled-extensions "[\"$UUID\"]"
    exec gnome-shell "$MODE" --wayland --mode="$SESSION_MODE"
'
