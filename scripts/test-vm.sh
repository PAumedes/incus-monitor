#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Create (or reuse) a GNOME desktop VM, install Incus with a demo container inside it, install
# the freshly built .deb, enable the extension and open the graphical console.
#
# usage: scripts/test-vm.sh <24.04|26.04>
# needs: `make incus-package RELEASE=<release>` first, and virt-viewer on the host.
set -euo pipefail
cd "$(dirname "$0")/.."

release=${1:-}
[[ $release == 24.04 || $release == 26.04 ]] || { echo "usage: $0 <24.04|26.04>" >&2; exit 2; }

deb=$(ls -t build/incus-"$release"/*.deb 2>/dev/null | head -1 || true)
[[ -n $deb ]] || { echo "No .deb for $release: run 'make incus-package RELEASE=$release'" >&2; exit 1; }
command -v remote-viewer >/dev/null || { echo "Install virt-viewer for the VM console" >&2; exit 1; }

uuid=$(python3 -c 'import json; print(json.load(open("data/metadata.json"))["uuid"])')
vm="imon-desktop-${release//./}"

if ! incus info "$vm" >/dev/null 2>&1; then
    incus launch "images:ubuntu/$release/desktop" "$vm" --vm \
        --config limits.cpu=2 --config limits.memory=4GiB --device root,size=20GiB </dev/null
    echo "Waiting for the VM agent…"
    until incus exec "$vm" -- true 2>/dev/null; do sleep 3; done
    incus exec "$vm" -- cloud-init status --wait >/dev/null 2>&1 || true

    # Incus inside the VM gives the extension something to show. 24.04's archive only has
    # Incus 0.6, so use the Zabbly LTS repository there.
    incus exec "$vm" -- bash -euo pipefail -c "
        export DEBIAN_FRONTEND=noninteractive
        if [[ $release == 24.04 ]]; then
            install -d /etc/apt/keyrings
            curl -fsSL https://pkgs.zabbly.com/key.asc -o /etc/apt/keyrings/zabbly.asc
            echo 'deb [signed-by=/etc/apt/keyrings/zabbly.asc] https://pkgs.zabbly.com/incus/lts-6.0 noble main' \
                >/etc/apt/sources.list.d/zabbly-incus-lts-6.0.list
        fi
        apt-get update -qq
        apt-get install -y -qq incus
        incus admin init --minimal
        usermod -aG incus-admin ubuntu
        incus launch images:alpine/edge demo
    "
fi

incus file push "$deb" "$vm/tmp/extension.deb"
incus exec "$vm" -- bash -euo pipefail -c "
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --reinstall /tmp/extension.deb
    sudo -u ubuntu dbus-run-session gsettings set org.gnome.shell enabled-extensions \"['$uuid']\"
"
incus restart "$vm"

echo "Opening the console of $vm (GNOME on Ubuntu $release). Log in as 'ubuntu'."
exec incus console "$vm" --type=vga
