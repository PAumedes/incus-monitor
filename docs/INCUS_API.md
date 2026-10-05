# Incus REST API usage

Reference: <https://linuxcontainers.org/incus/docs/main/rest-api/>. This page records only what we
use, plus the behaviour we observed against real servers (fixtures in `tests/fixtures/incus/`).

## Sockets

Discovery order (the first one that is connectable wins; the decision is re-evaluated after a
failure):

| Order | Path                              | Who can use it           | Notes                                                                     |
| ----- | --------------------------------- | ------------------------ | ------------------------------------------------------------------------- |
| 1     | `$INCUS_SOCKET`                   | whoever set it           | Honoured for parity with the CLI. Rarely set in a Shell session.          |
| 2     | `/var/lib/incus/unix.socket`      | members of `incus-admin` | Full access, all projects.                                                |
| 3     | `/var/lib/incus/unix.socket.user` | members of `incus`       | `incus-user` daemon: restricted to the user's own project (`user-<uid>`). |

Both sockets are **systemd socket-activated** (`incus.socket`, `incus-user.socket`). Connecting
starts the daemon if it is stopped. This is acceptable, because the user installed Incus, but it
is one more reason never to poll faster than necessary.

Connection errors map to UI states:

| Gio error                     | Meaning                        | `IncusError.kind`    |
| ----------------------------- | ------------------------------ | -------------------- |
| `NOT_FOUND`                   | Socket path absent             | `not-installed`      |
| `PERMISSION_DENIED`           | Not in the required group      | `permission-denied`  |
| `CONNECTION_REFUSED`          | Daemon down, activation failed | `unreachable`        |
| `TIMED_OUT` / our own timeout | Daemon hung                    | `unreachable`        |
| `CANCELLED`                   | `disable()` or superseded poll | `cancelled` (silent) |

## HTTP over the socket

We speak HTTP/1.1 directly on a `Gio.SocketConnection` (see [ADR-0003](adr/0003-raw-http-over-gio-unix-socket.md)):

```http
GET /1.0/instances?all-projects=true&recursion=1 HTTP/1.1
Host: incus
Accept: application/json
User-Agent: incus-monitor/<version>
Connection: close
```

- One connection per request, with `Connection: close`. The body ends at `Content-Length`, at
  the end of chunked encoding, or at EOF, in that order of preference.
- Request bodies are JSON with `Content-Type: application/json` and an explicit `Content-Length`.
- The response parser must handle `Transfer-Encoding: chunked`, because Incus uses it for large
  recursion responses.

## Envelopes

```jsonc
{ "type": "sync",  "status_code": 200, "metadata": { } }
{ "type": "async", "status_code": 100, "operation": "/1.0/operations/<uuid>", "metadata": { } }
{ "type": "error", "error_code": 404, "error": "Instance not found", "metadata": null }
```

Decode by `type`, then cross-check against the HTTP status. A mismatch is a `protocol` error.

## Endpoints used

| Purpose                 | Request                                                        | Notes                                                                                                                  |
| ----------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Server and compat check | `GET /1.0`                                                     | `environment.server_version`, `api_extensions`, `auth`. Once per connection lifecycle.                                 |
| List (cheap)            | `GET /1.0/instances?all-projects=true&recursion=1`             | Name, project, type, status, status_code, config.                                                                      |
| List with state         | `GET /1.0/instances?all-projects=true&recursion=2`             | Adds `state`: cpu, memory, network, disk, processes, started_at. Expensive for VMs (agent round-trip). Menu open only. |
| Change state            | `PUT /1.0/instances/<name>/state?project=<project>`            | Body `{"action":"start"                                                                                                | "stop" | "restart" | "freeze" | "unfreeze","timeout":30,"force":false}`. Returns `async`. |
| Wait for operation      | `GET /1.0/operations/<uuid>/wait?timeout=60&project=<project>` | Resolves to the final operation; check `status_code` 200 vs 400/401.                                                   |

Names in paths are URL-encoded with `encodeURIComponent`, and projects are always passed
explicitly on per-instance calls.

## Fields we read

| Field                                 | Use                                                                     |
| ------------------------------------- | ----------------------------------------------------------------------- |
| `name`, `project`, `type`             | Identity, icon                                                          |
| `status_code`                         | State (authoritative). `status` is display-only and localisation-prone. |
| `state.cpu.usage` (ns, cumulative)    | CPU %: Δusage / (Δt × allocated_time) × 100                             |
| `state.cpu.allocated_time` (ns per s) | Number of allocated CPUs × 1e9. Requires `instance_state_cpu_time`.     |
| `state.memory.usage`, `.total`        | Memory readout; `total` is the limit or the host total                  |
| `state.network.<iface>.counters`      | Rx/Tx rates; skip `loopback` type                                       |
| `state.network.<iface>.addresses[]`   | Primary address: first `global` scope, IPv4 preferred                   |
| `state.processes`                     | `-1` on a VM means no agent → "Open Console"                            |
| `state.started_at`                    | Uptime                                                                  |

Status codes we care about: `103` Running, `102` Stopped, `110` Frozen, `111` Thawed, plus
transitional `101`, `104`–`109`. Anything else maps to `unknown` and offers no actions.

## Compatibility gate

Required `api_extensions` (all present in 6.0.x):

- `instance_all_projects`: `all-projects=true` on `/1.0/instances`
- `container_full`: `recursion=2` on the instance list (the name predates VMs)
- `instance_state_cpu_time`: `state.cpu.allocated_time`
- `instance_state_started_at`: `state.started_at`

`core/incus/compat.ts` owns this list. If an extension is missing, the UI shows the "unsupported"
state instead of failing halfway. Verify the exact names against `tests/fixtures/incus/*/server.json`
whenever this list changes.

## Quirks

- **Forbidden project returns HTTP 500**, not 403. On the incus-user socket, a request without
  `project=` targets `default` and fails with `error_code: 500`, `"User does not have permissions
for project \"default\""` (fixture `6.0/error-forbidden-project.json`). Always use
  `all-projects=true` for listing and an explicit `project=` for everything else.
- `state.disk` is `{}` on the `dir` storage driver. Treat disk usage as optional.
- `memory.usage_peak` and `swap_usage_peak` are `0` on cgroup v2 hosts. Do not display them.
- `started_at` is RFC 3339 with nanoseconds and a numeric offset. `Date.parse` truncates to
  milliseconds, which is fine.
- Network interface `addresses` on loopback must be ignored when choosing the primary address.
