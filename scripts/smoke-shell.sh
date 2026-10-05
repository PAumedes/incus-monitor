#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Headless smoke test: boot a throwaway GNOME Shell with the installed extension enabled, ask the
# Shell over D-Bus whether it loaded without errors, toggle it off and on, then shut down.
# Runs without a display, so it also works over SSH. Exit status 0 means the extension is ACTIVE.
set -euo pipefail
cd "$(dirname "$0")/.."

uuid=$(python3 -c 'import json; print(json.load(open("data/metadata.json"))["uuid"])')
[[ -d ~/.local/share/gnome-shell/extensions/$uuid ]] || { echo "run 'make install' first" >&2; exit 1; }

profile=$(mktemp)
log=$(mktemp)
trap 'rm -f "$profile" "$log"' EXIT
printf 'user-db:incus_monitor_smoke\n' >"$profile"

# Match the real desktop: on Ubuntu the "ubuntu" session mode adds the dock, Yaru and AppIndicators.
session_mode=user
[[ -f /usr/share/gnome-shell/modes/ubuntu.json ]] && session_mode=ubuntu
export SESSION_MODE=$session_mode

export DCONF_PROFILE=$profile UUID=$uuid LOG=$log
dbus-run-session -- bash -c '
    set -euo pipefail
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell enabled-extensions "[\"$UUID\"]"
    gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800 --mode="$SESSION_MODE" >"$LOG" 2>&1 &
    shell=$!
    trap "kill $shell 2>/dev/null || true; wait $shell 2>/dev/null || true" EXIT

    call() {
        gdbus call --session --timeout 2 --dest org.gnome.Shell.Extensions \
            --object-path /org/gnome/Shell/Extensions --method "org.gnome.Shell.Extensions.$1" "$UUID"
    }
    # GNOME Shell ExtensionState: 1 = ACTIVE (named ENABLED before GNOME 47).
    state() { call GetExtensionInfo | grep -oE "'\''state'\'': <[0-9.]+>" | grep -oE "[0-9]+" | head -1; }
    errors() { call GetExtensionErrors; }

    for _ in $(seq 60); do
        s=$(state 2>/dev/null || true)
        [[ -n $s ]] && break
        sleep 0.5
    done
    echo "state after start: ${s:-unknown}"
    echo "errors: $(errors)"
    [[ ${s:-} == 1 ]] || { echo "--- shell log ---"; grep -iE "incus|error|JS" "$LOG" | tail -30; exit 1; }

    for round in 1 2 3; do
        call DisableExtension >/dev/null
        call EnableExtension >/dev/null
    done
    s=$(state)
    echo "state after 3 disable/enable cycles: $s"
    [[ $s == 1 ]] || exit 1
    if grep -iE "incus|IncusMonitor" "$LOG" | grep -iE "error|warning|critical"; then
        echo "warnings or errors mentioning the extension in the shell log" >&2
        exit 1
    fi
    echo "smoke test passed"
' 2>>"$log" || { echo "--- session log (tail) ---" >&2; tail -40 "$log" >&2; exit 1; }
