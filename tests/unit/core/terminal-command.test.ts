// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';
import { formatTerminalCommand, parseTerminalCommand } from '../../../src/core/terminal-command.js';

describe('parseTerminalCommand', () => {
    it.each([
        ['', []],
        ['   ', []],
        ['\t\n', []],
        ['ptyxis', ['ptyxis']],
        ['ptyxis --', ['ptyxis', '--']],
        ['  gnome-terminal   --  ', ['gnome-terminal', '--']],
        ['xterm\t-e', ['xterm', '-e']],
        ['/usr/bin/kgx --', ['/usr/bin/kgx', '--']],
    ])('turns %j into the argv prefix %j', (text, argv) => {
        expect(parseTerminalCommand(text)).toEqual(argv);
    });
});

describe('formatTerminalCommand', () => {
    it.each([
        [[], ''],
        [['ptyxis'], 'ptyxis'],
        [['ptyxis', '--'], 'ptyxis --'],
    ])('shows the stored argv %j as %j', (argv, text) => {
        expect(formatTerminalCommand(argv)).toBe(text);
    });

    it('round-trips what the user typed', () => {
        const argv = ['/usr/bin/kgx', '--'];
        expect(parseTerminalCommand(formatTerminalCommand(argv))).toEqual(argv);
    });
});
