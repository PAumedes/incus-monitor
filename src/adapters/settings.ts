// SPDX-License-Identifier: GPL-2.0-or-later
import type Gio from 'gi://Gio';

/** Typed view over the extension's GSettings. Values are read live on every access. */
export class GioSettings {
    readonly #settings: Gio.Settings;
    readonly #handlers = new Set<number>();
    #disposed = false;

    // The caller owns `settings` (the Extension creates and drops it); this class only owns the
    // signal connections it makes.
    constructor(settings: Gio.Settings) {
        this.#settings = settings;
    }

    get refreshIntervalSeconds(): number {
        return this.#settings.get_uint('refresh-interval');
    }

    get showRunningCount(): boolean {
        return this.#settings.get_boolean('show-running-count');
    }

    get showStoppedInstances(): boolean {
        return this.#settings.get_boolean('show-stopped-instances');
    }

    get terminalCommand(): readonly string[] {
        return this.#settings.get_strv('terminal-command');
    }

    /** Calls `callback` with the key that changed. Returns an unsubscribe function. */
    subscribe(callback: (key: string) => void): () => void {
        if (this.#disposed) return () => undefined;
        const id = this.#settings.connect('changed', (_settings, key) => {
            callback(key);
        });
        this.#handlers.add(id);
        return () => {
            if (this.#handlers.delete(id)) this.#settings.disconnect(id);
        };
    }

    dispose(): void {
        this.#disposed = true;
        for (const id of this.#handlers) this.#settings.disconnect(id);
        this.#handlers.clear();
    }
}
