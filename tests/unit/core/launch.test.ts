// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';

import {
    TERMINALS,
    buildArgv,
    detectTerminal,
    type LaunchTarget,
} from '../../../src/core/launch.js';

const CONTAINER: LaunchTarget = { kind: 'shell', name: 'web', project: 'default' };
const VM: LaunchTarget = { kind: 'console', name: 'vm-1', project: 'user-1000' };

const only =
    (...present: string[]) =>
    (program: string): string | undefined =>
        present.includes(program) ? `/usr/bin/${program}` : undefined;

describe('TERMINALS', () => {
    it('lists the known terminals in preference order', () => {
        expect(TERMINALS).toStrictEqual([
            { program: 'xdg-terminal-exec', args: [] },
            { program: 'ptyxis', args: ['--'] },
            { program: 'kgx', args: ['--'] },
            { program: 'gnome-terminal', args: ['--'] },
        ]);
    });
});

describe('detectTerminal', () => {
    it.each([
        [['xdg-terminal-exec', 'ptyxis', 'kgx', 'gnome-terminal'], ['/usr/bin/xdg-terminal-exec']],
        [
            ['ptyxis', 'kgx', 'gnome-terminal'],
            ['/usr/bin/ptyxis', '--'],
        ],
        [
            ['kgx', 'gnome-terminal'],
            ['/usr/bin/kgx', '--'],
        ],
        [['gnome-terminal'], ['/usr/bin/gnome-terminal', '--']],
    ])('with %j installed it returns the resolved prefix %j', (present, expected) => {
        expect(detectTerminal(only(...present))).toStrictEqual(expected);
    });

    it('returns undefined when no known terminal is installed', () => {
        expect(detectTerminal(only('xterm'))).toBeUndefined();
    });

    it('returns the path the lookup resolved, not the bare program name', () => {
        const prefix = detectTerminal(p => (p === 'kgx' ? '/opt/odd/kgx' : undefined));
        expect(prefix).toStrictEqual(['/opt/odd/kgx', '--']);
    });

    it('asks the lookup for bare program names in order, stopping at the first hit, once each', () => {
        const asked: string[] = [];
        detectTerminal(program => {
            asked.push(program);
            return program === 'kgx' ? '/usr/bin/kgx' : undefined;
        });
        expect(asked).toStrictEqual(['xdg-terminal-exec', 'ptyxis', 'kgx']);
    });

    it('asks about every candidate exactly once when none is installed', () => {
        const asked: string[] = [];
        detectTerminal(program => {
            asked.push(program);
            return undefined;
        });
        expect(asked).toStrictEqual(['xdg-terminal-exec', 'ptyxis', 'kgx', 'gnome-terminal']);
    });
});

describe('buildArgv', () => {
    it.each([
        [
            'a shell target runs a login shell in the container of its project',
            ['ptyxis', '--'],
            CONTAINER,
            ['ptyxis', '--', 'incus', 'exec', 'web', '--project', 'default', '--', 'su', '-l'],
        ],
        [
            'a console target attaches to the VM console in its project',
            ['kgx', '--'],
            VM,
            ['kgx', '--', 'incus', 'console', 'vm-1', '--project', 'user-1000'],
        ],
        [
            'a configured prefix is used verbatim',
            ['alacritty', '-e'],
            CONTAINER,
            ['alacritty', '-e', 'incus', 'exec', 'web', '--project', 'default', '--', 'su', '-l'],
        ],
        [
            'an empty prefix still yields the incus command',
            [],
            VM,
            ['incus', 'console', 'vm-1', '--project', 'user-1000'],
        ],
    ])('%s', (_name, prefix, target, expected) => {
        expect(buildArgv(prefix, target)).toStrictEqual({ ok: true, value: expected });
    });

    it.each([
        '',
        '-rf',
        '--help',
        'a b',
        'a;b',
        'a$(b)',
        'a\nb',
        '../x',
        '1abc',
        'x'.repeat(64),
        'ünï',
    ])('rejects the instance name %j', name => {
        expect(buildArgv(['ptyxis', '--'], { ...CONTAINER, name })).toStrictEqual({
            ok: false,
            error: { kind: 'invalid-name' },
        });
    });

    it.each(['', '-x', 'a b', 'p\nq', 'a;b', 'a$(b)', '`id`'])(
        'rejects the project %j',
        project => {
            expect(buildArgv(['ptyxis', '--'], { ...CONTAINER, project })).toStrictEqual({
                ok: false,
                error: { kind: 'invalid-name' },
            });
        },
    );

    it.each(['default', 'user-1000', 'my.proj', 'a', 'a-b', '0abc'])(
        'accepts the project %j',
        project => {
            expect(buildArgv(['t'], { ...CONTAINER, project }).ok).toBe(true);
        },
    );

    it.each(['a|b', 'a(b', 'x'.repeat(65)])('rejects the project %j', project => {
        expect(buildArgv(['t'], { ...CONTAINER, project })).toStrictEqual({
            ok: false,
            error: { kind: 'invalid-name' },
        });
    });

    it.each(['a', 'x'.repeat(63), 'web-01'])('accepts the instance name %j', name => {
        expect(buildArgv(['t'], { ...CONTAINER, name }).ok).toBe(true);
    });
});

describe('buildArgv for a log target', () => {
    const logTarget: LaunchTarget = { kind: 'log', name: 'web', project: 'default' };
    const argvOf = (target: LaunchTarget, prefix: readonly string[] = ['ptyxis', '--']) => {
        const built = buildArgv(prefix, target);
        if (!built.ok) throw new Error('expected a valid argv');
        return built.value;
    };

    it('keeps the configured prefix first', () => {
        expect(argvOf(logTarget, ['alacritty', '-e']).slice(0, 2)).toStrictEqual([
            'alacritty',
            '-e',
        ]);
    });

    it('runs a fixed sh -c script and passes the names as separate trailing entries', () => {
        const argv = argvOf(logTarget);
        expect(argv.slice(2, 4)).toStrictEqual(['sh', '-c']);
        expect(argv.slice(5)).toStrictEqual(['sh', 'web', 'default']);
        expect(argv).toHaveLength(8);
    });

    it('shows the instance log with incus info --show-log, reading names from the arguments', () => {
        const script = argvOf(logTarget)[4] ?? '';
        expect(script).toContain('incus info');
        expect(script).toContain('--show-log');
        expect(script).toContain('--project');
        expect(script).toContain('"$1"');
        expect(script).toContain('"$2"');
    });

    it('pipes the log through a pager the user can scroll and quit', () => {
        expect(argvOf(logTarget)[4]).toMatch(/\|\s*less\b/);
    });

    it('merges stderr into the pager so a failure is visible', () => {
        expect(argvOf(logTarget)[4]).toContain('2>&1');
    });

    it('does not wait on a silent read', () => {
        expect(argvOf(logTarget)[4]).not.toMatch(/\bread\b/);
    });

    it('uses the same script whatever the names are', () => {
        const other = argvOf({ kind: 'log', name: 'db-01', project: 'user-1000' });
        expect(other[4]).toBe(argvOf(logTarget)[4]);
        expect(other.slice(5)).toStrictEqual(['sh', 'db-01', 'user-1000']);
    });

    it('never puts a name into the script text', () => {
        const script = argvOf({ kind: 'log', name: 'secretname', project: 'secretproj' })[4] ?? '';
        expect(script).not.toContain('secretname');
        expect(script).not.toContain('secretproj');
    });

    it('works with an empty prefix', () => {
        expect(argvOf(logTarget, []).slice(0, 2)).toStrictEqual(['sh', '-c']);
    });

    it.each(['', '-rf', 'a b', 'a;b', 'a$(b)', 'a\nb', '1abc', 'x'.repeat(64)])(
        'rejects the instance name %j',
        name => {
            expect(buildArgv(['t'], { ...logTarget, name })).toStrictEqual({
                ok: false,
                error: { kind: 'invalid-name' },
            });
        },
    );

    it.each(['', '-x', 'a b', 'a;b', '`id`', 'a|b', 'a(b', 'x'.repeat(65)])(
        'rejects the project %j',
        project => {
            expect(buildArgv(['t'], { ...logTarget, project })).toStrictEqual({
                ok: false,
                error: { kind: 'invalid-name' },
            });
        },
    );
});
