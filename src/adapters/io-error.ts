// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

/** True when `error` is a GIO error with the given code (a `Gio.IOErrorEnum` member). */
export function isIOError(error: unknown, code: number): boolean {
    return error instanceof GLib.Error && error.matches(Gio.io_error_quark(), code);
}
