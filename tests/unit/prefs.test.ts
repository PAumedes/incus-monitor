// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const prefs = readFileSync('src/prefs.ts', 'utf8');
const schema = readFileSync(
    'data/schemas/org.gnome.shell.extensions.incus-monitor.gschema.xml',
    'utf8',
);

const refreshKey =
    /<key name="refresh-interval" type="u">([\s\S]*?)<\/key>/.exec(schema)?.[1] ?? '';

function constant(name: string): number {
    const value = new RegExp(`\\bconst ${name}\\s*=\\s*(\\d+)\\b`).exec(prefs)?.[1];
    return value === undefined ? Number.NaN : Number(value);
}

describe('prefs.ts', () => {
    it('gets gettext from the prefs resource, because the prefs process has no global _', () => {
        expect(prefs).toMatch(
            /import\s*\{[^}]*\bgettext as _\b[^}]*\}\s*from\s*'resource:\/\/\/org\/gnome\/Shell\/Extensions\/js\/extensions\/prefs\.js'/,
        );
    });

    it('only uses keys that exist in the schema', () => {
        const used = [...prefs.matchAll(/'((?:[a-z]+-)+[a-z]+)'/g)]
            .map(m => m[1] ?? '')
            .filter(s => /^(refresh|show|terminal)-/.test(s));
        expect(used.length).toBeGreaterThan(0);
        for (const key of used) expect(schema, key).toContain(`<key name="${key}"`);
    });

    it('translates only literal strings', () => {
        const calls = [...prefs.matchAll(/\b(?:_|gettext|ngettext)\(\s*([^)]*?)\s*[,)]/g)];
        for (const call of calls) expect(call[1], call[0]).toMatch(/^(['"`])[^$]*\1$/);
        expect(calls.length).toBeGreaterThan(0);
    });

    it('uses the pure core to turn the terminal entry into the stored argv', () => {
        expect(prefs).toMatch(/from '\.\/core\/terminal-command\.js'/);
    });

    it('explains in the group description that an empty Terminal entry means automatic', () => {
        const group = /new Adw\.PreferencesGroup\(\{([\s\S]*?)\}\)/.exec(prefs)?.[1] ?? '';
        expect(group).toMatch(/\bdescription:\s*_\(\s*(['"`])[^$]+\1\s*\)/);
    });

    it('declares the same refresh bounds as the schema range', () => {
        const range = /<range min="(\d+)" max="(\d+)"\/>/.exec(refreshKey);
        expect([constant('REFRESH_MIN_SECONDS'), constant('REFRESH_MAX_SECONDS')]).toEqual([
            Number(range?.[1]),
            Number(range?.[2]),
        ]);
    });
});

describe('refresh-interval schema', () => {
    it('is bounded to 2-60 seconds with a default of 10', () => {
        expect(refreshKey).toContain('<range min="2" max="60"/>');
        expect(refreshKey).toContain('<default>10</default>');
    });
});
