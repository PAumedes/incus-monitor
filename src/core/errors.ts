// SPDX-License-Identifier: GPL-2.0-or-later

/**
 * Every failure the UI can explain. `detail`, `path` and `reason` are diagnostic text for logs,
 * never shown as UI strings.
 */
export type IncusError =
    | { readonly kind: 'not-installed' }
    | { readonly kind: 'permission-denied' }
    | { readonly kind: 'unreachable' }
    | { readonly kind: 'timeout' }
    | { readonly kind: 'cancelled' }
    | { readonly kind: 'protocol'; readonly detail: string }
    // `path` is the JSON path of the offending field.
    | { readonly kind: 'decode'; readonly path: string; readonly detail: string }
    | { readonly kind: 'api'; readonly code: number; readonly message: string }
    | { readonly kind: 'unsupported'; readonly reason: string };
