# ADR-0003: Raw HTTP/1.1 over the Incus unix socket via Gio

- Status: Accepted
- Date: 2026-10-04

## Context

Incus exposes its REST API on a local unix socket. The options were:

1. **libsoup 3** with `remote-connectable` set to a `Gio.UnixSocketAddress`. This works, but it
   adds a GI dependency whose unix-socket behaviour varies across versions.
2. **Spawning `incus query`** on every poll. This forks a Go binary every few seconds, depends
   on the CLI's configuration (current remote, project) and complicates error mapping.
3. **Gio.SocketClient** with a minimal HTTP/1.1 client.

## Decision

Use `Gio.SocketClient.connect_async` to a `Gio.UnixSocketAddress`, write a `Connection: close`
request, and read the response with a pure, fully tested parser in `core/http/`. The transport
adapter only moves bytes and maps Gio errors.

## Consequences

- No runtime dependencies beyond Gio and GLib, which the Shell always has.
- We own an HTTP response parser. It is small (Content-Length, chunked, EOF) and pure, so it is
  exhaustively tested under Node. Byte-split tests guard against framing bugs.
- Remote (TLS) servers are out of scope for v1. Adding them later means a new Transport
  adapter, with no change to the core.

## Alternatives considered

See Context. `incus query` remains a debugging aid for contributors.
