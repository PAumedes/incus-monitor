#!/usr/bin/env bash
# SPDX-License-Identifier: GPL-2.0-or-later
# Create or remove a small set of demo instances so the extension can be seen with realistic data
# (running with and without CPU load, stopped, frozen, a VM) in `make nested` or a real session.
#
# Every instance is named with the prefix imon-demo-, and that prefix is the only thing `down`
# deletes, so instances that belong to the user are never touched. `up` is idempotent: existing
# demo instances are brought to the intended state instead of being recreated.
# Usage: scripts/demo-instances.sh up|down
set -euo pipefail

prefix=imon-demo-
image=images:alpine/edge
# A pid file lets `up` tell whether the load generator survived a restart of the container.
busy_cmd='echo $$ > /run/imon-busy; while :; do :; done'

state() {
    incus list "^$1\$" -c s -f csv -q
}

# Creates the instance unless it exists, then converges it to the wanted state. Every step ends in
# `|| return`, because callers may run it where `set -e` is suspended (inside an `if`).
ensure() {
    local name=$1 want=$2
    shift 2
    if [[ -z $(state "$name") ]]; then
        incus init -q "$image" "$name" "$@" || return
    fi
    case $want in
    RUNNING | FROZEN)
        if [[ $(state "$name") == STOPPED ]]; then incus start -q "$name" || return; fi
        if [[ $want == FROZEN && $(state "$name") == RUNNING ]]; then incus pause -q "$name" || return; fi
        ;;
    STOPPED)
        [[ $(state "$name") == STOPPED ]] || incus stop -q --force "$name" || return
        ;;
    esac
    return 0
}

start_busy_loop() {
    local name=$1
    # The container may not accept exec for a moment after it starts.
    for _ in $(seq 20); do
        incus exec -q "$name" -- true 2>/dev/null && break
        sleep 0.5
    done
    if ! incus exec -q "$name" -- sh -c 'kill -0 "$(cat /run/imon-busy 2>/dev/null)"' 2>/dev/null; then
        incus exec -q -d "$name" -- sh -c "$busy_cmd"
    fi
}

up() {
    ensure "${prefix}web" RUNNING
    ensure "${prefix}db" RUNNING
    ensure "${prefix}cache" STOPPED
    ensure "${prefix}batch" RUNNING
    start_busy_loop "${prefix}batch"
    ensure "${prefix}paused" FROZEN
    # VMs may be unavailable (no KVM, or the restricted project forbids them): not fatal. Alpine's
    # image is not signed for secure boot, so it has to be off.
    if ! ensure "${prefix}vm" RUNNING --vm -c limits.cpu=1 -c limits.memory=512MiB \
        -c security.secureboot=false 2>/dev/null; then
        echo "Skipping the VM: this project or host cannot run virtual machines." >&2
    fi
    incus list "^$prefix" -c ns4 -f compact -q
}

down() {
    local name
    while read -r name; do
        [[ $name == "$prefix"* ]] && incus delete -q --force "$name"
    done < <(incus list "^$prefix" -c n -f csv -q)
    return 0
}

case ${1:-} in
up) up ;;
down) down ;;
*)
    echo "usage: $0 up|down" >&2
    exit 2
    ;;
esac
