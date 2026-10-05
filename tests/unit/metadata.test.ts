// SPDX-License-Identifier: GPL-2.0-or-later
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Metadata {
    uuid: string;
    name: string;
    description: string;
    'shell-version': string[];
    url: string;
    'settings-schema': string;
    'gettext-domain': string;
    'session-modes'?: string[];
}

const metadata = JSON.parse(readFileSync('data/metadata.json', 'utf8')) as Metadata;
const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { name: string };

describe('metadata.json', () => {
    it('has a well-formed uuid outside the gnome.org namespace', () => {
        expect(metadata.uuid).toMatch(/^[A-Za-z0-9._-]+@[A-Za-z0-9._-]+$/);
        expect(metadata.uuid).not.toContain('gnome.org');
        expect(metadata.uuid.split('@')[0]).toBe(pkg.name);
    });

    it('targets exactly the GNOME releases shipped by supported Ubuntu LTS hosts', () => {
        expect(metadata['shell-version']).toEqual(['46', '47', '48', '49', '50']);
    });

    it('does not declare session modes', () => {
        expect(metadata['session-modes']).toBeUndefined();
    });

    it('declares clipboard use in the description', () => {
        expect(metadata.description).toMatch(/clipboard/i);
    });

    it('uses the uuid as gettext domain', () => {
        expect(metadata['gettext-domain']).toBe(metadata.uuid);
    });

    it('references a schema that exists with the required id and path', () => {
        const id = metadata['settings-schema'];
        expect(id).toBe(`org.gnome.shell.extensions.${pkg.name}`);

        const files = readdirSync('data/schemas');
        expect(files).toContain(`${id}.gschema.xml`);

        const xml = readFileSync(`data/schemas/${id}.gschema.xml`, 'utf8');
        expect(xml).toContain(`id="${id}"`);
        expect(xml).toContain(`path="/org/gnome/shell/extensions/${pkg.name}/"`);
        expect(xml).toContain(`gettext-domain="${metadata.uuid}"`);
    });
});
