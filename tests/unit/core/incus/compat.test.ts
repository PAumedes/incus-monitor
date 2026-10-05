// SPDX-License-Identifier: GPL-2.0-or-later
import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { REQUIRED_EXTENSIONS, checkCompat } from '../../../../src/core/incus/compat.js';
import { decodeServer } from '../../../../src/core/incus/decode.js';
import type { Server } from '../../../../src/core/incus/models.js';
import { readFixture } from '../../builders.js';

const DOCUMENTED = [
    'instance_all_projects',
    'container_full',
    'instance_state_cpu_time',
    'instance_state_started_at',
];

function server(extensions: readonly string[], version = '6.0.5'): Server {
    return { version, apiExtensions: new Set(extensions) };
}

function unsupportedReason(candidate: Server): string {
    const result = checkCompat(candidate);
    if (result.ok) throw new Error('expected unsupported');
    if (result.error.kind !== 'unsupported') throw new Error(`unexpected ${result.error.kind}`);
    return result.error.reason;
}

describe('REQUIRED_EXTENSIONS', () => {
    it('requires exactly these four extensions', () => {
        expect([...REQUIRED_EXTENSIONS]).toStrictEqual(DOCUMENTED);
    });
});

describe('checkCompat', () => {
    it('accepts a server with every required extension and returns it unchanged', () => {
        const candidate = server(DOCUMENTED);
        const result = checkCompat(candidate);
        expect(result.ok && result.value).toBe(candidate);
    });

    it('ignores extra unknown extensions', () => {
        expect(checkCompat(server([...DOCUMENTED, 'etag', 'something_new'])).ok).toBe(true);
    });

    it('does not judge the version string', () => {
        expect(checkCompat(server(DOCUMENTED, '99.0')).ok).toBe(true);
    });

    it.each(DOCUMENTED)('names %s when it is the only missing extension', missing => {
        const reason = unsupportedReason(server(DOCUMENTED.filter(name => name !== missing)));
        expect(reason).toContain(missing);
        for (const present of DOCUMENTED.filter(name => name !== missing))
            expect(reason).not.toContain(present);
    });

    it('names every missing extension in the required order', () => {
        const reason = unsupportedReason(server(['container_full', 'etag']));
        const positions = [
            'instance_all_projects',
            'instance_state_cpu_time',
            'instance_state_started_at',
        ].map(name => reason.indexOf(name));
        expect(positions.every(position => position >= 0)).toBe(true);
        expect(positions).toStrictEqual([...positions].sort((a, b) => a - b));
        expect(reason).not.toContain('container_full');
    });

    it('does not match extension names by substring', () => {
        const longer = server([
            'instance_all_projects',
            'container_full_extra',
            'instance_state_cpu_time',
            'instance_state_started_at',
        ]);
        expect(unsupportedReason(longer)).toContain('container_full');
        const shorter = server([
            'instance_all_projects',
            'container_full',
            'instance_state',
            'instance_state_started_at',
        ]);
        expect(unsupportedReason(shorter)).toContain('instance_state_cpu_time');
    });

    it('names all four when the server has no extensions', () => {
        const reason = unsupportedReason(server([]));
        for (const name of DOCUMENTED) expect(reason).toContain(name);
    });
});

const SERIES = readdirSync(new URL('../../../fixtures/incus/', import.meta.url), {
    withFileTypes: true,
})
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);

describe('recorded server fixtures', () => {
    it.each(SERIES)('series %s passes the compatibility gate', series => {
        const decoded = decodeServer(readFixture(series, 'server').metadata);
        if (!decoded.ok) throw new Error('fixture failed to decode');
        expect(checkCompat(decoded.value).ok).toBe(true);
    });
});
