---
name: incus-api
description: Incus REST API facts for this repo - sockets and groups, HTTP framing, envelopes, endpoints, state fields, status codes, project quirks, fixture recording. Use when writing or reviewing anything in src/core/incus, src/core/http, the transport adapter, or tests/fixtures.
---

# Incus API

The authoritative project notes are in `docs/INCUS_API.md`. Read them. This skill adds the
procedures.

## Probing safely (read-only)

```sh
S=/var/lib/incus/unix.socket.user          # or /var/lib/incus/unix.socket for incus-admin
curl -s --unix-socket $S http://incus/1.0 | jq '.metadata.environment.server_version'
curl -s --unix-socket $S 'http://incus/1.0/instances?all-projects=true&recursion=1' | jq
curl -s --unix-socket $S 'http://incus/1.0/instances?all-projects=true&recursion=2' | jq '.metadata[].state.cpu'
curl -si --unix-socket $S 'http://incus/1.0/instances?recursion=1'   # shows the 500 forbidden-project quirk
```

**Never** issue PUT, POST, PATCH or DELETE against the user's real daemon. To exercise state
changes, create a throwaway instance and delete it afterwards, only when the user explicitly asks.

## Recording fixtures

```sh
scripts/record-fixtures.py --version 6.0            # writes tests/fixtures/incus/6.0/*.json
git diff -- tests/fixtures                          # review: no names, addresses or fingerprints
```

To get Incus 7.0 LTS fixtures without touching the host daemon, use a VM:

```sh
incus launch images:ubuntu/24.04 incus7 --vm
incus exec incus7 -- bash -c 'curl -fsSL https://pkgs.zabbly.com/key.asc | gpg --dearmor -o /etc/apt/keyrings/zabbly.gpg && \
  echo "deb [signed-by=/etc/apt/keyrings/zabbly.gpg] https://pkgs.zabbly.com/incus/stable noble main" > /etc/apt/sources.list.d/zabbly-incus.list && \
  apt-get update && apt-get install -y incus python3 curl && incus admin init --auto'
# create a container, a VM, a stopped and a frozen instance; copy the script in; run with
# --socket /var/lib/incus/unix.socket --project default; pull the files back with incus file pull.
```

Check the Zabbly instructions (`https://github.com/zabbly/incus`) for the current repository
layout before running this.

## Decoding rules

- Treat every response as `unknown`. Decode with hand-written guards in `core/incus/decode.ts`.
  Return `decode` errors with a JSON path (`metadata[3].state.cpu.usage`).
- Status comes from `status_code`, not from the `status` string.
- Ignore unknown fields (forward compatibility with 7.x).
- Optional by design: `state` (recursion 1), `state.disk` entries, `state.network`,
  `allocated_time` (only if the compat gate is bypassed in tests).

## Request rules

- Listing: `all-projects=true` always. Per-instance: `?project=<instance.project>` always.
- Path segments: `encodeURIComponent(name)`.
- State change body: `{"action": "...", "timeout": 30, "force": false}`, then wait on the returned
  operation with `GET /1.0/operations/<id>/wait?timeout=60&project=<project>`.
