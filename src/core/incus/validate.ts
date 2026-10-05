// SPDX-License-Identifier: GPL-2.0-or-later

const INSTANCE_NAME = /^[A-Za-z](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
// Mirrors Incus's projectValidateName and validate.IsAPIName, plus a ban on Unicode control and
// format characters (bidi overrides, zero-width) that could spoof labels. The 64-byte cap is
// checked separately because a regex counts characters.
const PROJECT_NAME = /^[A-Za-z0-9](?:[^\s$?&+"'`*/_\p{C}]*[A-Za-z0-9])?$/u;
const MAX_PROJECT_BYTES = 64;
const OPERATION_PATH = /^\/1\.0\/operations\/[A-Za-z0-9-]{1,64}$/;
// \p{C} includes lone surrogates, which would otherwise break later string handling.
const UNSAFE_CHARS = /[\p{C}\p{Zl}\p{Zp}]/gu;
const MAX_SHOWN_LENGTH = 40;
const MAX_USER_MESSAGE_LENGTH = 500;

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isArray(value: unknown): value is readonly unknown[] {
    return Array.isArray(value);
}

export function isInstanceName(value: string): boolean {
    return INSTANCE_NAME.test(value);
}

export function isProjectName(value: string): boolean {
    return PROJECT_NAME.test(value) && new TextEncoder().encode(value).length <= MAX_PROJECT_BYTES;
}

/** Later requests are built from operation paths, so only the exact Incus shape is accepted. */
export function isOperationPath(value: string): boolean {
    return OPERATION_PATH.test(value);
}

/**
 * Daemon-supplied text made safe for a log line or error path: short and single-line, so a
 * hostile body cannot flood the log or forge entries.
 */
export function shortened(text: string): string {
    // Replacing after the cut also catches a surrogate pair split by it.
    const shown = text.slice(0, MAX_SHOWN_LENGTH).replace(UNSAFE_CHARS, '?');
    return text.length > MAX_SHOWN_LENGTH ? `${shown}...` : shown;
}

/** Daemon-supplied text bound for the UI: capped, with control and separator characters blanked. */
export function userMessage(text: string): string {
    // Sanitising after the cut also catches a surrogate pair split by it.
    return text.slice(0, MAX_USER_MESSAGE_LENGTH).replace(UNSAFE_CHARS, ' ');
}
