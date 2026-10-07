#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Report which development tools are installed and how to get the missing ones. Writes nothing.
# Exit status 1 only when a required tool is missing.
set -euo pipefail
cd "$(dirname "$0")/.."
source scripts/lib/ui.sh

# tool:apt-package. gettext is checked through msgfmt and xgettext, both from one package.
required=(node:nodejs npm:npm python3:python3 gjs:gjs zip:zip gettext:gettext
    glib-compile-schemas:libglib2.0-bin)
optional=(gnome-extensions:gnome-shell incus:incus mutter-dev-bin:mutter-dev-bin
    virt-viewer:virt-viewer debhelper:debhelper lintian:lintian debsign:devscripts
    dpkg-parsechangelog:dpkg-dev)

has() {
    case $1 in
        gettext) command -v msgfmt xgettext >/dev/null ;;
        mutter-dev-bin) [[ -x /usr/libexec/mutter-devkit ]] ;;
        debhelper) command -v dh >/dev/null ;;
        *) command -v "$1" >/dev/null ;;
    esac
}

# usage: check <report function> <entries...>; prints a line per tool and the missing packages
# on stdout, so the caller captures them. The report lines go to the terminal through stderr.
check() {
    local report=$1 entry tool
    shift
    for entry in "$@"; do
        tool=${entry%%:*}
        if has "$tool"; then
            ui_ok "$tool" >&2
        else
            "$report" "$tool not found" >&2
            echo "${entry#*:}"
        fi
    done
}

ui_step "Required tools"
mapfile -t required_missing < <(check ui_fail "${required[@]}")

if has node; then
    want=$(<.nvmrc)
    have=$(node --version)
    [[ ${have#v} == "${want%%.*}".* ]] || ui_warn "node $have, but .nvmrc asks for ${want%%.*}.x"
fi

ui_step "Optional tools (nested shell, VMs, .deb and PPA builds)"
mapfile -t optional_missing < <(check ui_warn "${optional[@]}")

if ((${#optional_missing[@]})); then
    ui_info "Install with: sudo apt install ${optional_missing[*]}"
fi
if ((${#required_missing[@]})); then
    ui_fail "Required tools are missing. Install with: sudo apt install ${required_missing[*]}"
    exit 1
fi
ui_done "All required tools are present"
