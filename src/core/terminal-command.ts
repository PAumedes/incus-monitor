// SPDX-License-Identifier: GPL-2.0-or-later

// Lives in core because prefs.ts imports gi:// and so cannot be unit-tested under Node. Splits on
// whitespace only: there is no quoting, by design, because the result is an argv prefix and never
// reaches a shell, so an argument that contains whitespace cannot be expressed.
export function parseTerminalCommand(text: string): readonly string[] {
    return text.split(/\s+/).filter(arg => arg !== '');
}

export function formatTerminalCommand(argv: readonly string[]): string {
    return argv.join(' ');
}
