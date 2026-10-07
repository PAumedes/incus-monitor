// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';

import { DASH } from '../../../src/core/format.js';
import {
    launchFailure,
    menuText,
    showLogLabel,
    spokenRate,
    spokenValue,
    workingName,
} from '../../../src/core/menu-text.js';

// The markers make an untranslated string visible.
const translate = (msgid: string): string => `[${msgid}]`;

describe('menuText', () => {
    it('translates the detail headings', () => {
        const { headings } = menuText(translate);
        expect(headings).toEqual({
            memory: '[Memory]',
            disk: '[Disk]',
            network: '[Network]',
            address: '[Address]',
            uptime: '[Uptime]',
            forwards: '[Forwards]',
        });
    });

    it('translates the buttons', () => {
        const { buttons } = menuText(translate);
        expect(buttons).toEqual({
            retry: '[Retry]',
            refresh: '[Refresh]',
            preferences: '[Preferences]',
        });
    });

    it('builds the copy-address accessible name from a template', () => {
        expect(menuText(translate).copyAddress('10.0.3.15')).toBe('[Copy address 10.0.3.15]');
    });

    it('keeps a placeholder-looking address literal', () => {
        expect(menuText(translate).copyAddress('{address}$&')).toBe('[Copy address {address}$&]');
    });
});

describe('spokenValue', () => {
    it('announces the dash as a translated "Not available"', () => {
        expect(spokenValue(DASH, translate)).toBe('[Not available]');
    });

    it.each(['3 %', '246 MB', '10.0.3.15', ''])('passes %j through unchanged', value => {
        expect(spokenValue(value, translate)).toBe(value);
    });
});

describe('spokenRate', () => {
    it.each([
        { direction: 'down', expected: '[Download 1.5 KB/s]' },
        { direction: 'up', expected: '[Upload 1.5 KB/s]' },
    ] as const)('uses a translated template for $direction', ({ direction, expected }) => {
        expect(spokenRate(direction, '1.5 KB/s', translate)).toBe(expected);
    });

    it.each([
        { direction: 'down', expected: '[Download not available]' },
        { direction: 'up', expected: '[Upload not available]' },
    ] as const)(
        'announces an unavailable $direction rate as one translated phrase',
        ({ direction, expected }) => {
            expect(spokenRate(direction, DASH, translate)).toBe(expected);
        },
    );
});

describe('workingName', () => {
    it('adds a translated working word to the row name', () => {
        expect(workingName('web01, Running', translate)).toBe('[web01, Running, working]');
    });

    it('keeps placeholder-looking names literal', () => {
        expect(workingName('{name}$&', translate)).toBe('[{name}$&, working]');
    });
});

describe('launchFailure', () => {
    it.each([
        {
            error: { kind: 'no-terminal' },
            message: '[No supported terminal was found. Set one in the preferences.]',
        },
        {
            error: { kind: 'spawn-failed', detail: '/usr/bin/x: not found' },
            message: '[The terminal could not be started.]',
        },
        {
            error: { kind: 'invalid-name' },
            message: '[This instance name cannot be used to open a terminal.]',
        },
    ] as const)('explains $error.kind with translated text', ({ error, message }) => {
        expect(launchFailure(error, translate)).toEqual({
            title: '[Could not open a terminal]',
            message,
        });
    });

    it('does not show the diagnostic detail of a failed spawn', () => {
        const { message } = launchFailure({ kind: 'spawn-failed', detail: 'SECRET' }, translate);
        expect(message).not.toContain('SECRET');
    });
});

describe('showLogLabel', () => {
    it('is the translated button label', () => {
        expect(showLogLabel(translate)).toBe('[Show log]');
    });
});
