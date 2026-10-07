// SPDX-License-Identifier: GPL-2.0-or-later
import type { CancelSignal } from './cancel.js';
import type { IncusError } from './errors.js';
import type { HttpRequest } from './http/request.js';
import type { HttpResponse } from './http/response.js';
import type { LaunchError, LaunchTarget } from './launch.js';
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

/**
 * Time and one-shot timers. Total: scheduling never throws. `setTimeout` returns a function that
 * cancels the timer. The callback fires at most once. Cancelling is idempotent and safe after the
 * timer has fired. `now()` is monotonic milliseconds, not wall time.
 */
export interface Clock {
    setTimeout(ms: number, callback: () => void): () => void;
    /** Milliseconds on a monotonic scale; only differences are meaningful. */
    now(): number;
}

/**
 * Opens a terminal running an `incus` command for an instance. An empty `terminalSetting` means
 * "detect one". Total: spawn failures come back as `spawn-failed`, never as a throw.
 */
export interface Launch {
    launch(target: LaunchTarget, terminalSetting: readonly string[]): Result<void, LaunchError>;
}
