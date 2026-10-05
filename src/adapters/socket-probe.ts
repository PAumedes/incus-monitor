// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import type { CancelSignal } from '../core/cancel.js';
import { isIOError } from './io-error.js';
import type { SocketAccess, SocketProbe } from '../core/ports.js';

Gio._promisify(Gio.File.prototype, 'query_info_async', 'query_info_finish');

const ATTRIBUTES = 'standard::type,access::can-write';

/** Classifies a socket path with a metadata query, so the daemon never sees a connection. */
export class GioSocketProbe implements SocketProbe {
    // Probes repeat on every discovery pass; one warning per distinct failure is enough.
    readonly #warned = new Set<string>();

    async access(path: string, signal: CancelSignal): Promise<SocketAccess> {
        if (signal.cancelled) return 'missing';
        const cancellable = new Gio.Cancellable();
        const off = signal.onCancel(() => {
            cancellable.cancel();
        });
        try {
            const info = await Gio.File.new_for_path(path).query_info_async(
                ATTRIBUTES,
                Gio.FileQueryInfoFlags.NONE,
                GLib.PRIORITY_DEFAULT,
                cancellable,
            );
            return classify(info);
        } catch (error) {
            return this.#fromError(error, path, cancellable);
        } finally {
            off();
        }
    }

    #fromError(error: unknown, path: string, cancellable: Gio.Cancellable): SocketAccess {
        // The port has no cancelled value; the caller discards the answer of a cancelled probe.
        if (cancellable.is_cancelled()) return 'missing';
        if (isIOError(error, Gio.IOErrorEnum.PERMISSION_DENIED)) return 'denied';
        if (
            isIOError(error, Gio.IOErrorEnum.NOT_FOUND) ||
            isIOError(error, Gio.IOErrorEnum.NOT_DIRECTORY)
        ) {
            return 'missing';
        }
        const code = error instanceof GLib.Error ? error.code : -1;
        const key = `${path}\0${String(code)}`;
        if (!this.#warned.has(key)) {
            this.#warned.add(key);
            console.warn(`Incus socket probe failed for ${path}: ${String(error)}`);
        }
        return 'missing';
    }
}

function classify(info: Gio.FileInfo): SocketAccess {
    // Below a directory the user cannot search, GIO answers without an error but also without
    // the attributes; reading them would raise a GLib critical.
    if (!info.has_attribute('standard::type') || !info.has_attribute('access::can-write')) {
        return 'denied';
    }
    // A socket is reported as a special file.
    if (info.get_file_type() !== Gio.FileType.SPECIAL) return 'missing';
    return info.get_attribute_boolean('access::can-write') ? 'usable' : 'denied';
}
