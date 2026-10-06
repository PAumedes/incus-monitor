#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Screenshots of the open menu with a row expanded, from a throwaway headless GNOME Shell.
#
# usage: scripts/ui-screenshots.sh [--scheme light|dark] [--out DIR] [--rows name1,name2] [--vm NAME] [--restart]
#   --scheme  colour scheme of the throwaway session (default light)
#   --out     where the PNGs and diagnostics.txt go (default build/screenshots)
#   --rows    instance names to expand (default: the first row)
#   --vm      run inside this Incus desktop VM as its "ubuntu" user, with the zip pushed in
#   --restart also restart each --rows instance from the keyboard and log key focus (use throwaway rows)
#   --zip     extension zip to use (default: the one `make zip` builds; set by --vm inside the VM)
#
# Per row it writes <scheme>-<row>-rest.png (expanded), -hover.png (pointer over the first action)
# -leave.png and -leave-header.png (pointer moved on to an inert detail row, which must clear the
# highlight) and -tab.png (reached with the keyboard, then Tab), plus <scheme>-diagnostics.txt with the focus
# and geometry of the row's items.
#
# Known limitation: synthetic clicks were not delivered on GNOME 46 (the 24.04 VM) in earlier
# trials, so there is no click scenario. Hover and keyboard focus did work there, but confirm it in
# <scheme>-diagnostics.txt (the "key focus" line) rather than trusting the picture alone.
#
# Nothing of the real session is touched: the extensions live in a private XDG_DATA_HOME, the
# settings in a private dconf profile and config directory, and all of it is removed on exit.
set -euo pipefail
cd "$(dirname "$0")/.."

scheme=light out=build/screenshots rows= vm= zip= restart=
while (($#)); do
    case $1 in
        --scheme) scheme=${2:?--scheme needs light or dark}; shift 2 ;;
        --out) out=${2:?--out needs a directory}; shift 2 ;;
        --rows) rows=${2:?--rows needs a comma-separated list}; shift 2 ;;
        --vm) vm=${2:?--vm needs an instance name}; shift 2 ;;
        --restart) restart=1; shift ;;
        --zip) zip=${2:?--zip needs a file}; shift 2 ;;
        *) echo "unknown option: $1 (see the header of $0)" >&2; exit 2 ;;
    esac
done
[[ $scheme == light || $scheme == dark ]] || { echo "--scheme must be light or dark" >&2; exit 2; }

if [[ -n $vm ]]; then
    uuid=$(python3 -c 'import json; print(json.load(open("data/metadata.json"))["uuid"])')
    zip_host=${zip:-build/$uuid.shell-extension.zip}
    [[ -f $zip_host ]] || { echo "$zip_host is missing: run 'make zip' first" >&2; exit 1; }
    work=/tmp/imon-screenshots
    # The VM user is "ubuntu" (uid 1000); runuser skips a login, so give it the session variables.
    incus exec "$vm" -- rm -rf "$work"
    incus exec "$vm" -- mkdir -p "$work/scripts"
    incus file push "$zip_host" "$vm$work/extension.zip" >/dev/null
    incus file push -r scripts/ui-screenshots scripts/ui-screenshots.sh "$vm$work/scripts/" >/dev/null
    incus exec "$vm" -- chown -R ubuntu:ubuntu "$work"
    incus exec "$vm" -- runuser -u ubuntu -- env HOME=/home/ubuntu XDG_RUNTIME_DIR=/run/user/1000 \
        "$work/scripts/ui-screenshots.sh" --scheme "$scheme" ${rows:+--rows "$rows"} ${restart:+--restart} \
        --zip "$work/extension.zip" --out "$work/out" </dev/null
    mkdir -p "$out"
    pull=$(mktemp -d)
    trap 'rm -rf "$pull"' EXIT
    incus file pull -r "$vm$work/out" "$pull" >/dev/null
    cp "$pull"/out/* "$out/"
    echo "Screenshots in $out"
    exit 0
fi

if [[ -z $zip ]]; then
    zip=build/$(python3 -c 'import json; print(json.load(open("data/metadata.json"))["uuid"])').shell-extension.zip
fi
[[ -f $zip ]] || { echo "$zip is missing: run 'make zip' first" >&2; exit 1; }
uuid=$(unzip -p "$zip" metadata.json | python3 -c 'import json, sys; print(json.load(sys.stdin)["uuid"])')

mkdir -p "$out"
out=$(realpath "$out")
rm -f "$out/$scheme"-*.png "$out/$scheme-diagnostics.txt" "$out/done" "$out/failed"

root=$(mktemp -d)
log=$(mktemp)
trap 'rm -rf "$root" "$log"' EXIT
helper=imon-shots@dev.local
ext=$root/data/gnome-shell/extensions
mkdir -p "$ext/$uuid" "$root/config"
unzip -q "$zip" -d "$ext/$uuid"
glib-compile-schemas "$ext/$uuid/schemas"
cp -r "scripts/ui-screenshots/$helper" "$ext/"

# dconf resolves "user-db:NAME" to a file under XDG_CONFIG_HOME/dconf, and a "-" in NAME is not
# accepted, so the profile name uses underscores.
profile=$root/profile
printf 'user-db:incus_monitor_shots\n' >"$profile"

# The "ubuntu" session mode needs the Yaru theme, and the Shell aborts at start-up without it. It
# also takes its light or dark look from the GTK theme, not from color-scheme alone.
session_mode=user
gtk_theme=
if [[ -f /usr/share/gnome-shell/modes/ubuntu.json && -f /usr/share/gnome-shell/theme/Yaru/gnome-shell-theme.gresource ]]; then
    session_mode=ubuntu
    gtk_theme=Yaru
    [[ $scheme == dark ]] && gtk_theme=Yaru-dark
fi

export XDG_DATA_HOME=$root/data XDG_CONFIG_HOME=$root/config DCONF_PROFILE=$profile
export SESSION_MODE=$session_mode GTK_THEME_NAME=$gtk_theme SCHEME=$scheme UUID=$uuid HELPER=$helper
export LOG=$log SHOT_DIR=$out SHOT_PREFIX="$scheme-" SHOT_ROWS=$rows SHOT_RESTART=$restart

dbus-run-session -- bash -c '
    set -euo pipefail
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell enabled-extensions "[\"$UUID\", \"$HELPER\"]"
    if [[ $SCHEME == dark ]]; then
        gsettings set org.gnome.desktop.interface color-scheme prefer-dark
    else
        gsettings set org.gnome.desktop.interface color-scheme default
    fi
    [[ -z $GTK_THEME_NAME ]] || gsettings set org.gnome.desktop.interface gtk-theme "$GTK_THEME_NAME"
    gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800 --mode="$SESSION_MODE" >"$LOG" 2>&1 &
    shell=$!
    # A Shell that is slow to quit must not hold the script: ask politely, then force it.
    stop_shell() {
        kill $shell 2>/dev/null || return 0
        for _ in $(seq 20); do kill -0 $shell 2>/dev/null || break; sleep 0.25; done
        kill -9 $shell 2>/dev/null || true
        wait $shell 2>/dev/null || true
    }
    trap stop_shell EXIT
    for _ in $(seq 120); do
        [[ -e $SHOT_DIR/done || -e $SHOT_DIR/failed ]] && break
        sleep 1
    done
' >>"$log" 2>&1 || true

if [[ -e $out/failed ]]; then
    echo "helper failed: $(cat "$out/failed")" >&2
    grep -iE "imon-shots|incus" "$log" | tail -20 >&2 || true
    rm -f "$out/failed"
    exit 1
fi
if [[ ! -e $out/done ]]; then
    echo "timed out: no screenshots. Shell log tail:" >&2
    tail -30 "$log" >&2
    exit 1
fi
rm -f "$out/done"
echo "Screenshots in $out"
