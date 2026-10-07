// SPDX-License-Identifier: GPL-2.0-or-later
import { isInstanceName, isProjectName } from './incus/validate.js';
import { err, ok, type Result } from './result.js';

export interface LaunchTarget {
    /**
     * `shell` runs a login shell in a container; `console` attaches to a VM console; `log` shows
     * the instance's log and waits for Enter.
     */
    readonly kind: 'shell' | 'console' | 'log';
    readonly name: string;
    readonly project: string;
}

export type LaunchError =
    | { readonly kind: 'invalid-name' }
    | { readonly kind: 'no-terminal' }
    | { readonly kind: 'spawn-failed'; readonly detail: string };

/** Resolves a program name to its path, or undefined when it is not installed. */
export type ProgramLookup = (program: string) => string | undefined;

interface Terminal {
    readonly program: string;
    readonly args: readonly string[];
}

// In preference order. xdg-terminal-exec takes the command directly; the others need `--`.
export const TERMINALS: readonly Terminal[] = [
    { program: 'xdg-terminal-exec', args: [] },
    { program: 'ptyxis', args: ['--'] },
    { program: 'kgx', args: ['--'] },
    { program: 'gnome-terminal', args: ['--'] },
];

/**
 * The terminal prefix to use when the setting is empty, or undefined if none is installed. The
 * program is the path the lookup resolved, so what runs is what was found.
 */
export function detectTerminal(lookup: ProgramLookup): readonly string[] | undefined {
    for (const { program, args } of TERMINALS) {
        const path = lookup(program);
        if (path !== undefined) return [path, ...args];
    }
    return undefined;
}

// Stricter than the decoder's project check: this value reaches a terminal's argv, where shell
// metacharacters, which Incus itself tolerates in project names, have no business. A project
// outside this set cannot be launched from the menu.
const LAUNCH_PROJECT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;

// A terminal closes when its command ends, which would take the log with it, so the output goes
// through a pager: the user scrolls, and quits with q, which is the only way the terminal closes.
// The names arrive as positional parameters, never inside the script text, so no name can be
// read as shell syntax.
const LOG_SCRIPT = 'incus info "$1" --project "$2" --show-log 2>&1 | less';

/** Names are validated here because they end up in argv, where `-x` would read as an option. */
export function buildArgv(
    prefix: readonly string[],
    target: LaunchTarget,
): Result<readonly string[], LaunchError> {
    if (
        !isInstanceName(target.name) ||
        !isProjectName(target.project) ||
        !LAUNCH_PROJECT.test(target.project)
    ) {
        return err({ kind: 'invalid-name' });
    }
    const incus = [target.name, '--project', target.project];
    switch (target.kind) {
        case 'shell':
            return ok([...prefix, 'incus', 'exec', ...incus, '--', 'su', '-l']);
        case 'console':
            return ok([...prefix, 'incus', 'console', ...incus]);
        case 'log':
            return ok([...prefix, 'sh', '-c', LOG_SCRIPT, 'sh', target.name, target.project]);
    }
}
