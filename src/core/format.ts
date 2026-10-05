// SPDX-License-Identifier: GPL-2.0-or-later

export type Translate = (msgid: string) => string;

const DASH = '—';
const FALLBACK_LOCALE = 'en';
const SI_BASE = 1000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** GLib reports locales like `de_DE.UTF-8@euro`; Intl wants BCP 47 and rejects the rest. */
function intlLocale(locale: string): string {
    const tag = (locale.split(/[.@:]/, 1)[0] ?? '').replace(/_/g, '-');
    if (tag === '' || tag === 'C' || tag === 'POSIX') return FALLBACK_LOCALE;
    try {
        return Intl.NumberFormat.supportedLocalesOf(tag).length > 0 ? tag : FALLBACK_LOCALE;
    } catch {
        return FALLBACK_LOCALE;
    }
}

function isDisplayable(value: number): boolean {
    return Number.isFinite(value) && value >= 0;
}

/**
 * Locale-aware formatting for the menu. Number formats are built once because formatting runs
 * on every refresh. Unit templates go through `translate` before numbers are substituted so
 * translators can reorder words. Intl.DurationFormat is avoided: GNOME 46's engine lacks it.
 */
export class Formatter {
    readonly #translate: Translate;
    readonly #percent: Intl.NumberFormat;
    readonly #whole: Intl.NumberFormat;
    readonly #oneDecimal: Intl.NumberFormat;
    readonly #byteUnits: readonly string[];
    readonly #rateUnits: readonly string[];

    constructor(locale: string, translate: Translate) {
        // The templates are called as `_()` so that xgettext extracts them (scripts/update-po.sh).
        const _ = translate;
        this.#byteUnits = [
            // Translators: SI byte units, 1000-based. The space in the msgid is a no-break space
            // (U+00A0); keep it.
            _('{value}\u00a0B'),
            // Translators: SI kilobytes.
            _('{value}\u00a0kB'),
            // Translators: SI megabytes.
            _('{value}\u00a0MB'),
            // Translators: SI gigabytes.
            _('{value}\u00a0GB'),
            // Translators: SI terabytes.
            _('{value}\u00a0TB'),
        ];
        this.#rateUnits = [
            // Translators: bytes per second. The space in the msgid is a no-break space (U+00A0);
            // keep it.
            _('{value}\u00a0B/s'),
            // Translators: kilobytes per second.
            _('{value}\u00a0kB/s'),
            // Translators: megabytes per second.
            _('{value}\u00a0MB/s'),
            // Translators: gigabytes per second.
            _('{value}\u00a0GB/s'),
            // Translators: terabytes per second.
            _('{value}\u00a0TB/s'),
        ];
        const tag = intlLocale(locale);
        this.#translate = translate;
        this.#percent = new Intl.NumberFormat(tag, { style: 'percent', maximumFractionDigits: 0 });
        this.#whole = new Intl.NumberFormat(tag, { maximumFractionDigits: 0 });
        this.#oneDecimal = new Intl.NumberFormat(tag, {
            minimumFractionDigits: 1,
            maximumFractionDigits: 1,
        });
    }

    percent(value: number | null): string {
        if (value === null || !Number.isFinite(value)) return DASH;
        return this.#percent.format(value / 100);
    }

    bytes(value: number): string {
        return this.#scaled(value, this.#byteUnits);
    }

    rate(value: number): string {
        return this.#scaled(value, this.#rateUnits);
    }

    duration(ms: number): string {
        if (!isDisplayable(ms)) return DASH;
        const _ = this.#translate;
        const days = Math.floor(ms / DAY_MS);
        const hours = Math.floor((ms % DAY_MS) / HOUR_MS);
        const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
        if (days > 0 && hours > 0) {
            // Translators: duration with abbreviated units that do not inflect:
            // d = days, h = hours.
            return this.#fillTemplate(
                _('{days} d {hours} h'),
                new Map([
                    ['days', days],
                    ['hours', hours],
                ]),
            );
        }
        if (days > 0) {
            // Translators: duration; d = days (an abbreviation, it does not inflect).
            return this.#fillTemplate(_('{days} d'), new Map([['days', days]]));
        }
        if (hours > 0 && minutes > 0) {
            // Translators: duration; h = hours, min = minutes (abbreviations, they do not
            // inflect).
            return this.#fillTemplate(
                _('{hours} h {minutes} min'),
                new Map([
                    ['hours', hours],
                    ['minutes', minutes],
                ]),
            );
        }
        if (hours > 0) {
            // Translators: duration; h = hours (an abbreviation, it does not inflect).
            return this.#fillTemplate(_('{hours} h'), new Map([['hours', hours]]));
        }
        if (minutes > 0) {
            // Translators: duration; min = minutes (an abbreviation, it does not inflect).
            return this.#fillTemplate(_('{minutes} min'), new Map([['minutes', minutes]]));
        }
        // Translators: uptime shorter than one minute; min = minutes.
        return _('< 1 min');
    }

    #scaled(value: number, units: readonly string[]): string {
        if (!isDisplayable(value)) return DASH;
        let scaled = value;
        let result = DASH;
        for (const [unit, template] of units.entries()) {
            if (unit > 0) scaled /= SI_BASE;
            const rounded =
                unit === 0 || scaled >= 10 ? Math.round(scaled) : Math.round(scaled * 10) / 10;
            // Rounding can carry into the next unit (999_999 B is "1.0 MB", not "1000 kB").
            if (rounded < SI_BASE || unit === units.length - 1) {
                const format = rounded < 10 && unit > 0 ? this.#oneDecimal : this.#whole;
                result = this.#fillTemplate(template, new Map([['value', rounded]]), format);
                break;
            }
        }
        return result;
    }

    #fillTemplate(
        template: string,
        values: ReadonlyMap<string, number>,
        format: Intl.NumberFormat = this.#whole,
    ): string {
        return template.replace(/\{(\w+)\}/g, (match, key: string) => {
            const number = values.get(key);
            return number === undefined ? match : format.format(number);
        });
    }
}
