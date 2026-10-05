// SPDX-License-Identifier: GPL-2.0-or-later
import type { IncusError } from '../errors.js';
import { err, ok, type Result } from '../result.js';

import { isRecord, shortened } from './decode.js';

export type Envelope =
    | { readonly kind: 'sync'; readonly metadata: unknown }
    | { readonly kind: 'async'; readonly operation: string; readonly metadata: unknown };

type Decoded<T> = Result<T, IncusError>;

const OPERATION_PATTERN = /^\/1\.0\/operations\/[A-Za-z0-9-]{1,64}$/;
const MAX_API_MESSAGE_LENGTH = 500;

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
    return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

function tryParseJson(body: string): unknown {
    try {
        return JSON.parse(body);
    } catch {
        return undefined;
    }
}

function protocolError(detail: string): Decoded<never> {
    return err({ kind: 'protocol', detail });
}

/**
 * Renders a daemon-supplied value for a log line: short and single-line, so a hostile body
 * cannot flood the log or forge entries.
 */
function describe(value: unknown): string {
    if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
        return String(value);
    }
    if (typeof value === 'string') {
        return `"${shortened(value)}"`;
    }
    return typeof value;
}

function statusMismatch(
    type: string,
    httpStatus: number,
    codeField: string,
    code: unknown,
): Decoded<never> {
    const http = String(httpStatus);
    return protocolError(
        `${type} envelope has invalid status (HTTP ${http}, ${codeField} ${describe(code)})`,
    );
}

function decodeSync(httpStatus: number, json: Record<string, unknown>): Decoded<Envelope> {
    const code = json['status_code'];
    if (!isIntegerInRange(httpStatus, 200, 299) || !isIntegerInRange(code, 200, 399)) {
        return statusMismatch('sync', httpStatus, 'status_code', code);
    }
    return ok({ kind: 'sync', metadata: json['metadata'] });
}

function decodeAsync(httpStatus: number, json: Record<string, unknown>): Decoded<Envelope> {
    const code = json['status_code'];
    if (httpStatus !== 202 || !isIntegerInRange(code, 100, 199)) {
        return statusMismatch('async', httpStatus, 'status_code', code);
    }
    const operation = json['operation'];
    // Later requests are built from this path, so reject anything that could alter them.
    if (typeof operation !== 'string' || !OPERATION_PATTERN.test(operation)) {
        return protocolError(
            `async envelope operation is not /1.0/operations/<id>: ${describe(operation)}`,
        );
    }
    return ok({ kind: 'async', operation, metadata: json['metadata'] });
}

function decodeError(httpStatus: number, json: Record<string, unknown>): Decoded<never> {
    const code = json['error_code'];
    if (!isIntegerInRange(code, 400, 599) || code !== httpStatus) {
        return statusMismatch('error', httpStatus, 'error_code', code);
    }
    const message = json['error'];
    if (typeof message !== 'string') return protocolError('error envelope has no message');
    // The message reaches UI notifications; cap it.
    return err({ kind: 'api', code, message: message.slice(0, MAX_API_MESSAGE_LENGTH) });
}

/**
 * Decodes an Incus response body. Error envelopes come back as `api` errors; any envelope that
 * contradicts the HTTP status, or is malformed, is a `protocol` error. `metadata` is passed
 * through untouched for the caller's decoder.
 */
export function decodeEnvelope(httpStatus: number, body: string): Decoded<Envelope> {
    const json = tryParseJson(body);
    if (!isRecord(json)) return protocolError('response body is not a JSON object');

    const type = json['type'];
    switch (type) {
        case 'sync':
            return decodeSync(httpStatus, json);
        case 'async':
            return decodeAsync(httpStatus, json);
        case 'error':
            return decodeError(httpStatus, json);
        default:
            return protocolError(`unknown envelope type ${describe(type)}`);
    }
}
