// SPDX-License-Identifier: GPL-2.0-or-later
import { isCancelled, type CancelSignal } from '../cancel.js';
import type { IncusError } from '../errors.js';
import type { HttpRequest } from '../http/request.js';
import type { Transport } from '../ports.js';
import { andThen, err, ok, type Result } from '../result.js';

import { decodeInstances, decodeOperationResult, decodeServer } from './decode.js';
import { decodeEnvelope, type Envelope } from './envelope.js';
import type { Instance, InstanceRef, OperationResult, Server } from './models.js';
import { isInstanceName, isOperationPath, isProjectName, userMessage } from './validate.js';

const ACTIONS = ['start', 'stop', 'restart', 'freeze', 'unfreeze'] as const;
export type InstanceAction = (typeof ACTIONS)[number];

/** A running Incus operation; `path` is validated, `project` scopes the wait request. */
export interface Operation {
    readonly path: string;
    readonly project: string;
}

type Outcome<T> = Promise<Result<T, IncusError>>;

// Request parameters sent to Incus, not client-side timeouts, hence they live here.
const STATE_TIMEOUT_SECONDS = 30;
const WAIT_TIMEOUT_SECONDS = 60;
const OPERATION_SUCCEEDED = 200;
const OPERATION_FAILED: readonly number[] = [400, 401];

const protocol = (detail: string): Result<never, IncusError> => err({ kind: 'protocol', detail });
const cancelled = (): Result<never, IncusError> => err({ kind: 'cancelled' });

function decodeBody(bytes: Uint8Array): Result<string, IncusError> {
    try {
        return ok(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
        return protocol('response body is not valid UTF-8');
    }
}

function syncMetadata(envelope: Envelope): Result<unknown, IncusError> {
    return envelope.kind === 'sync' ? ok(envelope.metadata) : protocol('expected a sync envelope');
}

function operationOutcome({ statusCode, error }: OperationResult): Result<true, IncusError> {
    if (statusCode === OPERATION_SUCCEEDED) return ok(true);
    // Any other status means the wait ended before the operation reached a final state.
    if (!OPERATION_FAILED.includes(statusCode)) return err({ kind: 'timeout' });
    return err({ kind: 'api', code: statusCode, message: userMessage(error) });
}

function decodeOperationOutcome(metadata: unknown): Result<true, IncusError> {
    return andThen(decodeOperationResult(metadata), operationOutcome);
}

export class IncusClient {
    constructor(private readonly transport: Transport) {}

    server(signal: CancelSignal): Outcome<Server> {
        return this.#sync({ method: 'GET', path: '/1.0' }, signal, decodeServer);
    }

    instances(withState: boolean, signal: CancelSignal): Outcome<readonly Instance[]> {
        const recursion = withState ? 2 : 1;
        const path = `/1.0/instances?all-projects=true&recursion=${String(recursion)}`;
        return this.#sync({ method: 'GET', path }, signal, decodeInstances);
    }

    async changeState(
        ref: InstanceRef,
        action: InstanceAction,
        signal: CancelSignal,
    ): Outcome<Operation> {
        if (!isInstanceName(ref.name) || !isProjectName(ref.project)) {
            return protocol('invalid instance reference');
        }
        // The type is erased at runtime and the action is serialised into the request body.
        if (!ACTIONS.includes(action)) return protocol('unknown instance action');
        const name = encodeURIComponent(ref.name);
        const project = encodeURIComponent(ref.project);
        const path = `/1.0/instances/${name}/state?project=${project}`;
        const body = { action, timeout: STATE_TIMEOUT_SECONDS, force: false };
        const envelope = await this.#send({ method: 'PUT', path, body }, signal);
        if (!envelope.ok) return envelope;
        if (envelope.value.kind !== 'async') return protocol('expected an async envelope');
        return ok({ path: envelope.value.operation, project: ref.project });
    }

    wait(operation: Operation, signal: CancelSignal): Outcome<true> {
        if (!isOperationPath(operation.path) || !isProjectName(operation.project)) {
            return Promise.resolve(protocol('invalid operation reference'));
        }
        const project = encodeURIComponent(operation.project);
        const timeout = String(WAIT_TIMEOUT_SECONDS);
        const path = `${operation.path}/wait?timeout=${timeout}&project=${project}`;
        const request: HttpRequest = { method: 'GET', path };
        return this.#sync(request, signal, decodeOperationOutcome);
    }

    async #sync<T>(
        request: HttpRequest,
        signal: CancelSignal,
        decode: (metadata: unknown) => Result<T, IncusError>,
    ): Outcome<T> {
        const envelope = await this.#send(request, signal);
        return andThen(andThen(envelope, syncMetadata), decode);
    }

    async #send(request: HttpRequest, signal: CancelSignal): Outcome<Envelope> {
        if (isCancelled(signal)) return cancelled();
        const response = await this.transport.request(request, signal);
        if (isCancelled(signal)) return cancelled();
        if (!response.ok) return response;
        const body = decodeBody(response.value.body);
        return andThen(body, text => decodeEnvelope(response.value.status, text));
    }
}
