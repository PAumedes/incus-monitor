# Incus REST API usage

Reference: <https://linuxcontainers.org/incus/docs/main/rest-api/>. This page records only what we
use, plus the behaviour we observed against real servers (fixtures in `tests/fixtures/incus/`).

## Sockets

Discovery (`core/socket.ts`) classifies each candidate path without connecting. The first usable
one wins. A non-empty override, which the composition root reads from `INCUS_SOCKET`, is the only
candidate, as with the `incus` CLI. Otherwise the system socket comes before the user socket.
With no usable candidate, the result is `permission-denied` if any candidate exists but is
inaccessible (including an inaccessible parent directory), and `not-installed` otherwise. The
monitor re-runs discovery after a connection failure.

| Order    | Path                              | Who can use it           | Notes                                                                     |
| -------- | --------------------------------- | ------------------------ | ------------------------------------------------------------------------- |
| override | `$INCUS_SOCKET`                   | whoever set it           | Replaces the list when set, as in the CLI. Rarely set in a Shell session. |
| 1        | `/var/lib/incus/unix.socket`      | members of `incus-admin` | Full access, all projects.                                                |
| 2        | `/var/lib/incus/unix.socket.user` | members of `incus`       | `incus-user` daemon: restricted to the user's own project (`user-<uid>`). |

Both sockets are **systemd socket-activated** (`incus.socket`, `incus-user.socket`). Connecting
starts the daemon if it is stopped. This is acceptable, because the user installed Incus, but it
is one more reason never to poll faster than necessary.

Connection errors map to UI states:

| Gio error                     | Meaning                        | `IncusError.kind`    |
| ----------------------------- | ------------------------------ | -------------------- |
| `NOT_FOUND`                   | Socket path absent             | `not-installed`      |
| `PERMISSION_DENIED`           | Not in the required group      | `permission-denied`  |
| `CONNECTION_REFUSED`          | Daemon down, activation failed | `unreachable`        |
| `TIMED_OUT` / our own timeout | Daemon hung                    | `timeout`            |
| `CANCELLED`                   | `disable()` or superseded poll | `cancelled` (silent) |

The UI shows `unreachable` and `timeout` the same way ("Incus is not responding", with Retry).
They stay separate kinds so that logs say which one happened.

## HTTP over the socket

We speak HTTP/1.1 directly on a `Gio.SocketConnection` (see [ADR-0003](adr/0003-raw-http-over-gio-unix-socket.md)).
The codec is `core/http/request.ts` and `core/http/response.ts`.

```http
GET /1.0/instances?all-projects=true&recursion=1 HTTP/1.1
Host: incus
Accept: application/json
User-Agent: incus-monitor
Connection: close
```

- One connection per request, with `Connection: close`. Request bodies are JSON with
  `Content-Type: application/json` and a `Content-Length` in UTF-8 bytes.
- The request path must be printable ASCII without spaces. Callers percent-encode names first;
  anything else is a programmer error and `encodeRequest` throws.
- Incus answers with `Transfer-Encoding: chunked`, even for small bodies, so chunked framing is
  the main path. `Content-Length` and read-to-EOF are also supported. Chunked wins when both are
  present.
- The parser is incremental and binary-safe, and it is strict: CRLF line endings only, a 3-digit
  status in 100–599, digits-only `Content-Length` (conflicting duplicates rejected), hex-only
  chunk sizes, and `Transfer-Encoding` must be exactly `chunked` (any letter case).
- Limits, enforced as soon as they are exceeded: header section 64 KiB, chunk-size line and
  trailer section 64 KiB each, body 32 MiB (including declared lengths). Violations are
  `protocol` errors.
- Trailers are skipped, not validated (only their size counts). Interim 1xx responses are not
  supported: Incus never sends them, because we send no `Expect` header.

## Envelopes

```jsonc
{ "type": "sync",  "status_code": 200, "metadata": { } }
{ "type": "async", "status_code": 100, "operation": "/1.0/operations/<uuid>", "metadata": { } }
{ "type": "error", "error_code": 404, "error": "Instance not found", "metadata": null }
```

Decode by `type`, then cross-check against the HTTP status (`core/incus/envelope.ts`). Anything
that doesn't fit is a `protocol` error:

| `type`  | HTTP status    | Code field            | Other requirements                                                        |
| ------- | -------------- | --------------------- | ------------------------------------------------------------------------- |
| `sync`  | 200–299        | `status_code` 200–399 | —                                                                         |
| `async` | 202            | `status_code` 100–199 | `operation` is `/1.0/operations/<id>`, id `[A-Za-z0-9-]{1,64}`            |
| `error` | = `error_code` | `error_code` 400–599  | string `error`, becomes an `api` error (message capped at 500 characters) |

Codes must be integers. Incus uses 1xx for operation states, 2xx–3xx for success and 4xx–5xx for
failures. The operation id is validated here because later requests are built from it. Protocol
details quote daemon values only in shortened, single-line form, so a hostile body cannot flood
or forge log lines.

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

| Field                                 | Use                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `name`, `project`, `type`             | Identity, icon                                                                        |
| `status_code`                         | State (authoritative). `status` is display-only and localisation-prone.               |
| `state.cpu.usage` (ns, cumulative)    | CPU %: Δusage / (Δt × allocated_time) × 100                                           |
| `state.cpu.allocated_time` (ns per s) | Number of allocated CPUs × 1e9. Requires `instance_state_cpu_time`. 0 = not reported. |
| `state.memory.usage`, `.total`        | Memory readout; `total` is the limit or the host total (0 = not reported)             |
| `state.network.<iface>.counters`      | Rx/Tx rates; skip `loopback` type                                                     |
| `state.network.<iface>.addresses[]`   | Primary address: first `global` scope, IPv4 preferred                                 |
| `state.processes`                     | `-1` on a VM means no agent → "Open Console"; absent is treated as `-1`               |
| `state.started_at`                    | Uptime                                                                                |

Status mapping (`core/incus/decode.ts`): `103` Running and `113` Ready → running; `102` →
stopped; `110` → frozen; `112` → error; `101`, `104`–`109` and `111` (Thawed, only seen briefly
after an unfreeze) → busy; any other integer → unknown, which offers no actions.

Decoding rules: unknown fields are ignored; inside `state`, absent or null pieces read as zero
or empty, while a present value of the wrong type is a `decode` error naming its JSON path.
Instance names follow the Incus rules exactly (1–63 ASCII letters, digits and dashes, starting
with a letter, not ending with a dash). Project names follow
the Incus rules (`projectValidateName` and `validate.IsAPIName`): at most 64 bytes, starting and
ending with an ASCII letter or digit, no whitespace and none of `$ ? & + " ' \` * / _`. On top of
that we reject Unicode control and format characters (`\p{C}`: bidi overrides, zero-width
characters, lone surrogates), which could spoof labels or forge log lines. Daemon values that
appear in error paths or details are shortened and have the same character classes replaced.

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
