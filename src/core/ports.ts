// SPDX-License-Identifier: GPL-2.0-or-later
import type { CancelSignal } from './cancel.js';
import type { IncusError } from './errors.js';
import type { HttpRequest } from './http/request.js';
import type { HttpResponse } from './http/response.js';
import type { Result } from './result.js';

/** What the current user may do with a socket path. */
export type SocketAccess = 'missing' | 'denied' | 'usable';

/**
 * Classifies a socket path without connecting to it. Total: the promise never rejects, because
 * the adapter maps every failure to a value.
 */
export interface SocketProbe {
    access(path: string, signal: CancelSignal): Promise<SocketAccess>;
}

/**
 * Sends one HTTP request to the Incus daemon and returns the parsed response. Total: the promise
 * never rejects. The adapter encodes the request, maps an encoding failure to `protocol`,
 * connection failures to `not-installed`, `permission-denied`, `unreachable` or `timeout`, and an
 * aborted request to `cancelled`.
 */
export interface Transport {
    request(request: HttpRequest, signal: CancelSignal): Promise<Result<HttpResponse, IncusError>>;
}
