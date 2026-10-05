// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    buildArgv,
    detectTerminal,
    type LaunchError,
    type LaunchTarget,
    type ProgramLookup,
} from '../core/launch.js';
import type { Launch } from '../core/ports.js';
import { err, ok, type Result } from '../core/result.js';

const findInPath: ProgramLookup = program => GLib.find_program_in_path(program) ?? undefined;

/** Starts a terminal with an argv array; nothing is ever passed through a shell. */
export class GioLauncher implements Launch {
    launch(target: LaunchTarget, terminalSetting: readonly string[]): Result<void, LaunchError> {
        const prefix = terminalSetting.length > 0 ? terminalSetting : detectTerminal(findInPath);
        if (prefix === undefined) return err({ kind: 'no-terminal' });
        const argv = buildArgv(prefix, target);
        if (!argv.ok) return argv;
        try {
            // Gio reaps the child on exit, so the handle is not kept.
            Gio.Subprocess.new([...argv.value], Gio.SubprocessFlags.NONE);
        } catch (error) {
            return err({ kind: 'spawn-failed', detail: String(error) });
        }
        return ok(undefined);
    }
}
