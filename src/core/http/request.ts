// SPDX-License-Identifier: GPL-2.0-or-later

export type HttpMethod = 'GET' | 'PUT';

export interface HttpRequest {
    readonly method: HttpMethod;
    readonly path: string;
    readonly body?: unknown;
}

// Printable ASCII without space: nothing in the path can start a new header or request line.
const SAFE_PATH = /^\/[!-~]*$/;

/** Throws on an unsafe path or an unserialisable body: both are caller bugs. */
export function encodeRequest(request: HttpRequest): Uint8Array {
    if (!SAFE_PATH.test(request.path)) {
        throw new Error(`unsafe request path: ${JSON.stringify(request.path).slice(0, 80)}`);
    }
    const encoder = new TextEncoder();
    const lines = [
        `${request.method} ${request.path} HTTP/1.1`,
        'Host: incus',
        'Accept: application/json',
        'User-Agent: incus-monitor',
        'Connection: close',
    ];
    if (request.body === undefined) {
        return encoder.encode(`${lines.join('\r\n')}\r\n\r\n`);
    }
    // At runtime JSON.stringify returns undefined for functions and toJSON() => undefined.
    const json: unknown = JSON.stringify(request.body);
    if (typeof json !== 'string') throw new Error('request body is not JSON-serialisable');
    const body = encoder.encode(json);
    lines.push('Content-Type: application/json', `Content-Length: ${String(body.length)}`);
    const head = encoder.encode(`${lines.join('\r\n')}\r\n\r\n`);
    const out = new Uint8Array(head.length + body.length);
    out.set(head);
    out.set(body, head.length);
    return out;
}
