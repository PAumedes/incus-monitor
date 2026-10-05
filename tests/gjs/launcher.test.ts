// SPDX-License-Identifier: GPL-2.0-or-later
// GioLauncher against fake terminals. Every test runs with PATH pointing at a private directory,
// so a terminal found by bare name can only ever be one of the fakes: no test can open a real
// terminal, even if the launcher stopped using the resolved path.
import GLib from 'gi://GLib';

import { GioLauncher } from '../../src/adapters/launcher.js';
import type { LaunchTarget } from '../../src/core/launch.js';
import { assert, test } from './harness.js';
import { eventually, readFile, withTempDir, writeFile } from './support.js';

const CONTAINER: LaunchTarget = { kind: 'shell', name: 'web', project: 'default' };
const VM: LaunchTarget = { kind: 'console', name: 'vm-1', project: 'user-1000' };

interface Fakes {
    readonly dir: string;
    /** The argv a fake terminal was started with, once it has run. */
    recorded(name: string): string | undefined;
}

/** Installs executable fakes named `names` in a private directory that is the whole PATH. */
async function withFakeTerminals(
    names: readonly string[],
    body: (fakes: Fakes) => Promise<void>,
): Promise<void> {
    await withTempDir(async dir => {
        for (const name of names) {
            const terminal = `${dir}/${name}`;
            // Absolute mv: the private PATH holds nothing but the fakes.
            writeFile(
                terminal,
                `#!/bin/sh\nprintf '%s\\n' "$@" > "$0.out.tmp"\n/bin/mv "$0.out.tmp" "$0.out"\n`,
                0o755,
            );
        }
        const saved = GLib.getenv('PATH');
        GLib.setenv('PATH', dir, true);
        try {
            await body({ dir, recorded: name => readFile(`${dir}/${name}.out`) });
        } finally {
            if (saved === null) GLib.unsetenv('PATH');
            else GLib.setenv('PATH', saved, true);
        }
    });
}

const SHELL_ARGV = '--\nincus\nexec\nweb\n--project\ndefault\n--\nsu\n-l\n';

test('launcher: spawns the configured terminal with the argv array', () =>
    withFakeTerminals(['alacritty'], async fakes => {
        const result = new GioLauncher().launch(CONTAINER, [`${fakes.dir}/alacritty`, '--']);
        assert.ok(result.ok);
        assert.equal(await eventually(() => fakes.recorded('alacritty')), SHELL_ARGV);
    }));

test('launcher: with an empty setting it starts the detected terminal', () =>
    withFakeTerminals(['ptyxis'], async fakes => {
        const result = new GioLauncher().launch(VM, []);
        assert.ok(result.ok);
        assert.equal(
            await eventually(() => fakes.recorded('ptyxis')),
            '--\nincus\nconsole\nvm-1\n--project\nuser-1000\n',
        );
    }));

test('launcher: with an empty setting it prefers xdg-terminal-exec, which takes no separator', () =>
    withFakeTerminals(['ptyxis', 'xdg-terminal-exec'], async fakes => {
        const result = new GioLauncher().launch(VM, []);
        assert.ok(result.ok);
        assert.equal(
            await eventually(() => fakes.recorded('xdg-terminal-exec')),
            'incus\nconsole\nvm-1\n--project\nuser-1000\n',
        );
        assert.equal(fakes.recorded('ptyxis'), undefined);
    }));

test('launcher: arguments are never interpreted by a shell', () =>
    withFakeTerminals(['alacritty'], async fakes => {
        const marker = `${fakes.dir}/pwned`;
        // Metacharacters in the configured prefix stay literal argv elements.
        const result = new GioLauncher().launch(CONTAINER, [
            `${fakes.dir}/alacritty`,
            `;touch ${marker}`,
        ]);
        assert.ok(result.ok);
        const text = await eventually(() => fakes.recorded('alacritty'));
        assert.ok(text.startsWith(`;touch ${marker}\nincus\n`));
        assert.equal(readFile(marker), undefined);
    }));

test('launcher: no setting and no installed terminal is no-terminal', () =>
    withFakeTerminals([], () => {
        const result = new GioLauncher().launch(CONTAINER, []);
        assert.deepEqual(result, { ok: false, error: { kind: 'no-terminal' } });
        return Promise.resolve();
    }));

test('launcher: an invalid name fails before anything is spawned', () =>
    withFakeTerminals(['alacritty'], fakes => {
        const result = new GioLauncher().launch({ ...CONTAINER, name: 'a;b' }, [
            `${fakes.dir}/alacritty`,
            '--',
        ]);
        assert.deepEqual(result, { ok: false, error: { kind: 'invalid-name' } });
        // The result is returned synchronously, so nothing was spawned to wait for.
        assert.equal(fakes.recorded('alacritty'), undefined);
        return Promise.resolve();
    }));

test('launcher: a terminal that cannot be executed is spawn-failed, not a throw', () =>
    withFakeTerminals([], () => {
        const result = new GioLauncher().launch(CONTAINER, ['/nonexistent/terminal', '--']);
        assert.ok(!result.ok);
        assert.equal(result.error.kind, 'spawn-failed');
        return Promise.resolve();
    }));
