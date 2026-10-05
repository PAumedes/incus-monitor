// SPDX-License-Identifier: GPL-2.0-or-later
import type { CancelSignal } from '../../../src/core/cancel.js';
import type { IncusError } from '../../../src/core/errors.js';
import type { HttpRequest } from '../../../src/core/http/request.js';
import type { HttpResponse } from '../../../src/core/http/response.js';
import type { Transport } from '../../../src/core/ports.js';
import { err, ok, type Result } from '../../../src/core/result.js';

export interface Reply {
    readonly status: number;
    readonly body: string | Uint8Array;
}

/**
 * Maps `METHOD path` to a canned reply or a transport error. Any other request throws, so every
 * test states exactly which requests the client may send. `onRequest` runs before the answer
 * resolves, which lets a test cancel while the request is "in flight".
 */
export class FakeTransport implements Transport {
    readonly requests: HttpRequest[] = [];
    readonly signals: CancelSignal[] = [];

    constructor(
        private readonly script: Readonly<Record<string, Reply | IncusError>>,
        private readonly onRequest: () => void = () => undefined,
    ) {}

    request(request: HttpRequest, signal: CancelSignal): Promise<Result<HttpResponse, IncusError>> {
        const key = `${request.method} ${request.path}`;
        const reply = this.script[key];
        if (reply === undefined) throw new Error(`Unexpected request ${key}`);
        this.requests.push(request);
        this.signals.push(signal);
        this.onRequest();
        if ('kind' in reply) return Promise.resolve(err(reply));
        const body =
            typeof reply.body === 'string' ? new TextEncoder().encode(reply.body) : reply.body;
        return Promise.resolve(ok({ status: reply.status, headers: new Map(), body }));
    }
}
