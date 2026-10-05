#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Run a command from the repository root inside a clean, disposable Ubuntu container: the same
# environment CI uses. Build outputs are copied back to build/incus-<release>/.
#
# usage: scripts/incus-run.sh <24.04|26.04> <command...>
#   e.g. scripts/incus-run.sh 24.04 make ci
#
# The provisioned base image is built once and cached as a local Incus image. It is rebuilt
# automatically when scripts/ci/provision.sh or .nvmrc change.
set -euo pipefail
cd "$(dirname "$0")/.."

usage() {
    echo "usage: $0 <24.04|26.04> <command...>" >&2
    exit 2
}

release=${1:-}
[[ $release == 24.04 || $release == 26.04 ]] || usage
shift
(($# > 0)) || usage

# `incus launch` reads instance config from stdin when stdin is not a terminal, so under make or
# CI it waits forever on an open pipe: every call that needs no input gets </dev/null.
# The timeouts are a second line of defence against a stuck run.
LAUNCH_TIMEOUT=300

# systemd in Ubuntu 26.04 cannot set up its service sandboxes in an unprivileged container
# without nesting: systemd-networkd hangs, leaving no IPv4 lease and no DNS.
LAUNCH_OPTIONS=(--config security.nesting=true)

# Builds use IPv4 only (see provision.sh); wait for an IPv4 default route and working DNS.
wait_for_network() {
    incus exec "$1" -- bash -c '
        for _ in $(seq 90); do
            ip -4 route show default | grep -q . && getent ahostsv4 archive.ubuntu.com >/dev/null && exit 0
            sleep 1
        done
        exit 1' </dev/null || {
        echo "container $1 has no IPv4 network after 90 s." >&2
        echo "Check: incus exec $1 -- systemctl list-jobs   (and docs/TESTING.md#troubleshooting)" >&2
        return 1
    }
}

prefix="incus-monitor-ci-$release"
fingerprint=$(cat scripts/ci/provision.sh .nvmrc | sha256sum | cut -c1-12)
alias="$prefix-$fingerprint"
short=${release//./}

if ! incus image info "$alias" >/dev/null 2>&1; then
    echo "Building base image $alias (first run only)…"
    builder="imon-image-$short-$fingerprint"
    trap 'incus delete --force "$builder" >/dev/null 2>&1 || true' EXIT
    timeout "$LAUNCH_TIMEOUT" incus launch "images:ubuntu/$release" "$builder" "${LAUNCH_OPTIONS[@]}" --quiet </dev/null
    wait_for_network "$builder"
    incus file push scripts/ci/provision.sh .nvmrc "$builder/root/" --quiet
    incus exec "$builder" -- bash /root/provision.sh /root/.nvmrc </dev/null
    incus stop "$builder"
    timeout "$LAUNCH_TIMEOUT" incus publish "$builder" --alias "$alias" --quiet </dev/null
    incus delete --force "$builder"
    trap - EXIT
    incus image list --format csv --columns l |
        grep -E "^$prefix-" | grep -vx "$alias" | xargs -r -n1 incus image delete || true
fi

name="imon-ci-$short-$$"
trap 'incus delete --force "$name" >/dev/null 2>&1 || true' EXIT
timeout "$LAUNCH_TIMEOUT" incus launch "$alias" "$name" --ephemeral "${LAUNCH_OPTIONS[@]}" --quiet </dev/null
wait_for_network "$name"

tar --exclude=./node_modules --exclude=./dist --exclude=./build --exclude=./.git -cf - . |
    incus exec "$name" -- bash -c 'mkdir -p /src && tar -xf - -C /src'

status=0
incus exec "$name" --cwd /src --env CI=true -- "$@" </dev/null || status=$?

out="build/incus-$release"
rm -rf "$out"
mkdir -p "$out"
if incus exec "$name" -- test -d /src/build; then
    incus exec "$name" -- tar -cf - -C /src/build . | tar -xf - -C "$out"
    echo "Artifacts: $out/"
fi

exit "$status"
