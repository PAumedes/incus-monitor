#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Install everything the build needs on a fresh Ubuntu 24.04 or 26.04 system. Run as root.
# Shared by scripts/incus-run.sh, GitHub Actions and GitLab CI, so every environment is identical.
#
# usage: scripts/ci/provision.sh [path/to/.nvmrc]
set -euo pipefail

nvmrc=${1:-$(dirname "$0")/../../.nvmrc}
node_version=$(<"$nvmrc")

# IPv4 only: build hosts may advertise IPv6 routes without IPv6 connectivity, which makes
# apt, curl and npm stall on unreachable addresses before falling back.
echo 'precedence ::ffff:0:0/96 100' >>/etc/gai.conf
echo 'Acquire::ForceIPv4 "true";' >/etc/apt/apt.conf.d/99force-ipv4

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
    ca-certificates curl xz-utils git make python3 zip gettext \
    gjs gir1.2-glib-2.0 libglib2.0-bin adwaita-icon-theme \
    build-essential debhelper dpkg-dev fakeroot lintian

case $(dpkg --print-architecture) in
    amd64) arch=x64 ;;
    arm64) arch=arm64 ;;
    *) echo "unsupported architecture: $(dpkg --print-architecture)" >&2; exit 1 ;;
esac

# Node.js from nodejs.org: the Ubuntu archive ships Node 18 on 24.04, too old for the toolchain.
tarball="node-v$node_version-linux-$arch.tar.xz"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -4fsSLo "$tmp/$tarball" "https://nodejs.org/dist/v$node_version/$tarball"
curl -4fsSLo "$tmp/SHASUMS256.txt" "https://nodejs.org/dist/v$node_version/SHASUMS256.txt"
(cd "$tmp" && grep " $tarball\$" SHASUMS256.txt | sha256sum --check --quiet -)
tar -xJf "$tmp/$tarball" -C /usr/local --strip-components=1 --no-same-owner

echo "Provisioned: node $(node --version), gjs $(gjs --version | cut -d' ' -f2)"
