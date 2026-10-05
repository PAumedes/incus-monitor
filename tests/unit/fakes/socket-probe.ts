// SPDX-License-Identifier: GPL-2.0-or-later
import type { CancelSignal } from '../../../src/core/cancel.js';
import type { SocketAccess, SocketProbe } from '../../../src/core/ports.js';

/**
 * Maps each expected path to its access level. Probing any other path throws, so every test
 * states exactly which paths discovery may touch. `onAccess` runs before the answer resolves.
 */
export class FakeSocketProbe implements SocketProbe {
    readonly calls: string[] = [];
    readonly signals: CancelSignal[] = [];

    constructor(
        private readonly answers: Readonly<Record<string, SocketAccess>>,
        private readonly onAccess: (path: string) => void = () => undefined,
    ) {}

    access(path: string, signal: CancelSignal): Promise<SocketAccess> {
        const answer = this.answers[path];
        if (answer === undefined) throw new Error(`Unexpected probe of ${path}`);
        this.calls.push(path);
        this.signals.push(signal);
        this.onAccess(path);
        return Promise.resolve(answer);
    }
}
