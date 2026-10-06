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
# The mode loads the Yaru theme, and the Shell aborts at start-up when that package is missing.
session_mode=user
if [[ -f /usr/share/gnome-shell/modes/ubuntu.json && -f /usr/share/gnome-shell/theme/Yaru/gnome-shell-theme.gresource ]]; then
    session_mode=ubuntu
fi
export SESSION_MODE=$session_mode

export DCONF_PROFILE=$profile UUID=$uuid LOG=$log
dbus-run-session -- bash -c '
    set -euo pipefail
    gsettings set org.gnome.shell disable-user-extensions false
    gsettings set org.gnome.shell enabled-extensions "[\"$UUID\"]"
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

    # GNOME 47+ serves the extensions API as its own bus name; 46 serves it from org.gnome.Shell.
    bus=org.gnome.Shell.Extensions path=/org/gnome/Shell/Extensions
    call() {
        gdbus call --session --timeout 2 --dest "$bus" \
            --object-path "$path" --method "org.gnome.Shell.Extensions.$1" "$UUID"
    }
    # GNOME Shell ExtensionState: 1 = ACTIVE (named ENABLED before GNOME 47).
    state() { call GetExtensionInfo | grep -oE "'\''state'\'': <[0-9.]+>" | grep -oE "[0-9]+" | head -1; }
    errors() { call GetExtensionErrors; }

    for _ in $(seq 60); do
        for target in "org.gnome.Shell.Extensions /org/gnome/Shell/Extensions" "org.gnome.Shell /org/gnome/Shell"; do
            read -r bus path <<<"$target"
            s=$(state 2>/dev/null || true)
            [[ -n $s ]] && break 2
        done
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
