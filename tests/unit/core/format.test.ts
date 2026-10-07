// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';

import { fill, Formatter, formatPort } from '../../../src/core/format.js';

const identity = (msgid: string): string => msgid;
const en = new Formatter('en', identity);
const de = new Formatter('de', identity);

// Intl puts a no-break space between the number and the percent sign in German.
const NBSP = ' ';
const nb = (text: string): string => text.replace(' ', NBSP);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('Formatter.percent', () => {
    it.each([
        [en, 4, '4%'],
        [de, 4, `4${NBSP}%`],
        [en, 0, '0%'],
        [en, 100, '100%'],
        [en, 3.6, '4%'],
        [en, 3.4, '3%'],
    ])('formats %# as a whole-number percentage in its locale', (formatter, value, expected) => {
        expect(formatter.percent(value)).toBe(expected);
    });

    it.each([null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'shows a dash for %s',
        value => {
            expect(en.percent(value)).toBe('—');
        },
    );
});

describe('Formatter.bytes', () => {
    // Each row: label, bytes, expected. Numbers and units are joined by a no-break space.
    it.each([
        ['zero stays in bytes', 0, '0 B'],
        ['just below 1 kB stays in bytes', 999, '999 B'],
        ['exactly 1 kB switches unit (SI, 1000-based)', 1000, '1.0 kB'],
        ['a megabyte value', 1_500_000, '1.5 MB'],
        ['a gigabyte value', 3_940_000_000, '3.9 GB'],
        ['a terabyte value', 2_500_000_000_000, '2.5 TB'],
    ])('uses the unit for the magnitude: %s', (_label, bytes, expected) => {
        expect(en.bytes(bytes)).toBe(nb(expected));
    });

    it.each([
        ['9.94 keeps one decimal', 9940, '9.9 kB'],
        ['9.949 rounds down and keeps one decimal', 9949, '9.9 kB'],
        ['9.995 rounds up to 10 and drops the decimal', 9995, '10 kB'],
        ['10 drops the decimal', 10_000, '10 kB'],
        ['220 MB has none', 220_441_536, '220 MB'],
    ])('shows one decimal below 10 and none from 10: %s', (_label, bytes, expected) => {
        expect(en.bytes(bytes)).toBe(nb(expected));
    });

    it.each([
        ['999_999 B carries to MB', 999_999, '1.0 MB'],
        ['999_499_999 B stays in MB', 999_499_999, '999 MB'],
        ['999_500_000 B carries to GB', 999_500_000, '1.0 GB'],
    ])('picks the unit after rounding: %s', (_label, bytes, expected) => {
        expect(en.bytes(bytes)).toBe(nb(expected));
    });

    it.each([
        ['just below 1000 TB', 999_999_999_999_999, '1,000 TB'],
        ['5000 TB', 5_000_000_000_000_000, '5,000 TB'],
    ])('stops at TB: %s', (_label, bytes, expected) => {
        expect(en.bytes(bytes)).toBe(nb(expected));
    });

    it('formats the number in the locale', () => {
        expect([de.bytes(3_940_000_000), de.bytes(1_234_000_000_000_000)]).toStrictEqual([
            nb('3,9 GB'),
            nb('1.234 TB'),
        ]);
    });

    it('passes the unit template through translate so translators can reorder it', () => {
        const fake = new Formatter('en', msgid =>
            msgid.replace(NBSP, ' ') === '{value} MB' ? `{value}${NBSP}Mo` : msgid,
        );
        expect(fake.bytes(220_441_536)).toBe(`220${NBSP}Mo`);
    });
});

describe('Formatter.rate', () => {
    it.each([
        ['B/s', 999, '999 B/s'],
        ['kB/s', 12_000, '12 kB/s'],
        ['MB/s', 1_500_000, '1.5 MB/s'],
        ['GB/s', 2_000_000_000, '2.0 GB/s'],
        ['TB/s', 3_000_000_000_000, '3.0 TB/s'],
    ])('has a template for %s', (_unit, rate, expected) => {
        expect(en.rate(rate)).toBe(nb(expected));
    });

    it.each([
        ['a fraction below 0.5 rounds to zero', 0.4, '0 B/s'],
        ['a fraction above 1000 keeps one decimal', 1234.56, '1.2 kB/s'],
        ['999.5 B/s carries to kB/s', 999.5, '1.0 kB/s'],
        ['999_999 B/s carries to MB/s', 999_999, '1.0 MB/s'],
    ])('rounds fractions and carries: %s', (_label, rate, expected) => {
        expect(en.rate(rate)).toBe(nb(expected));
    });

    it('formats the number in the locale', () => {
        expect(de.rate(1_500_000)).toBe(nb('1,5 MB/s'));
    });

    it('passes the unit template through translate', () => {
        const fake = new Formatter('en', msgid =>
            msgid.replace(NBSP, ' ') === '{value} kB/s' ? `{value}${NBSP}ko/s` : msgid,
        );
        expect(fake.rate(12_000)).toBe(`12${NBSP}ko/s`);
    });
});

describe('Formatter.bytes and rate with invalid input', () => {
    it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'show a dash for %d',
        value => {
            expect([en.bytes(value), en.rate(value)]).toStrictEqual(['—', '—']);
        },
    );
});

describe('Formatter locale handling', () => {
    it.each(['C', 'POSIX', '', 'en_US.UTF-8', 'C.UTF-8', 'de_DE@euro', 'en-', 'i', 'zh_Hans_CN'])(
        'does not throw for the locale %j',
        locale => {
            const formatter = new Formatter(locale, identity);
            expect(() => [
                formatter.percent(4),
                formatter.bytes(1234.5),
                formatter.rate(1234.5),
                formatter.duration(HOUR),
            ]).not.toThrow();
        },
    );

    it('treats a POSIX locale with encoding like its language', () => {
        expect(new Formatter('de_DE.UTF-8', identity).bytes(1234.5)).toBe(nb('1,2 kB'));
    });

    it.each(['C', 'POSIX', '', 'en-', 'i'])('falls back to English output for %j', locale => {
        const formatter = new Formatter(locale, identity);
        expect([formatter.percent(4), formatter.bytes(1234.5)]).toStrictEqual(['4%', nb('1.2 kB')]);
    });
});

describe('Formatter.duration', () => {
    it.each([
        [0, '< 1 min'],
        [59_999, '< 1 min'],
        [MIN, '1 min'],
        [45 * MIN, '45 min'],
        [HOUR - 1, '59 min'],
        [HOUR, '1 h'],
        [3 * HOUR, '3 h'],
        [3 * HOUR + 12 * MIN, '3 h 12 min'],
        [DAY - 1, '23 h 59 min'],
        [DAY, '1 d'],
        [3 * DAY + 5 * HOUR + 59 * MIN, '3 d 5 h'],
        [1234 * DAY, '1,234 d'],
    ])('formats %d ms in English', (ms, expected) => {
        expect(en.duration(ms)).toBe(expected);
    });

    it('formats numbers in the pinned locale', () => {
        expect(de.duration(1234 * DAY)).toBe('1.234 d');
    });

    it.each([-1, Number.NaN, -DAY, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
        'shows a dash for %d',
        ms => {
            expect(en.duration(ms)).toBe('—');
        },
    );

    it('passes every template through translate and fills placeholders afterwards', () => {
        const table: Record<string, string> = {
            '< 1 min': '< 1 min.',
            '{minutes} min': '{minutes} mn',
            '{hours} h {minutes} min': '{hours} h {minutes} mn',
            '{days} d {hours} h': '{days} j {hours} h',
        };
        const fr = new Formatter('fr', msgid => table[msgid] ?? msgid);
        expect([
            fr.duration(0),
            fr.duration(5 * MIN),
            fr.duration(2 * HOUR + 3 * MIN),
            fr.duration(2 * DAY + HOUR),
        ]).toStrictEqual(['< 1 min.', '5 mn', '2 h 3 mn', '2 j 1 h']);
    });

    it('leaves an unknown placeholder in a translated template literally', () => {
        const hostile = new Formatter('en', msgid =>
            msgid === '{minutes} min' ? '{constructor} {toString} {minutes}' : msgid,
        );
        expect(hostile.duration(5 * MIN)).toBe('{constructor} {toString} 5');
    });
});

describe('Formatter unit templates with unknown placeholders', () => {
    it('leaves them literally in bytes output', () => {
        const hostile = new Formatter('en', msgid =>
            msgid.replace(NBSP, ' ') === '{value} MB' ? '{constructor}: {value}' : msgid,
        );
        expect(hostile.bytes(220_441_536)).toBe('{constructor}: 220');
    });
});

describe('fill', () => {
    it('substitutes a placeholder', () => {
        expect(fill('Hello {name}', { name: 'web01' })).toBe('Hello web01');
    });

    it('substitutes a repeated placeholder each time', () => {
        expect(fill('{x}-{x}', { x: 'a' })).toBe('a-a');
    });

    it('keeps replacement patterns like $& literal', () => {
        expect(fill('<{x}>', { x: '$& $1 $$' })).toBe('<$& $1 $$>');
    });

    it('does not expand a placeholder that appears inside a value', () => {
        expect(fill('{a} {b}', { a: '{b}', b: 'B' })).toBe('{b} B');
    });

    it('leaves a placeholder with no value as it is', () => {
        expect(fill('{missing} {x}', { x: '1' })).toBe('{missing} 1');
    });

    it('does not read Object.prototype members as values', () => {
        expect(fill('{toString} {constructor}', {})).toBe('{toString} {constructor}');
    });
});

describe('formatPort', () => {
    it.each([
        [1, 'en', '1'],
        [80, 'en', '80'],
        [18080, 'en', '18080'],
        [65535, 'en', '65535'],
        [65535, 'de', '65535'],
        [65535, 'fr', '65535'],
        [8080, 'ar-EG', '٨٠٨٠'],
        [8080, 'en_US.UTF-8', '8080'],
        [8080, 'C', '8080'],
    ])('writes port %d for locale %s as %s, without a group separator', (port, locale, text) => {
        expect(formatPort(port, locale)).toBe(text);
    });
});
