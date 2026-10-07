// SPDX-License-Identifier: GPL-2.0-or-later
import { DASH, fill, type Translate } from './format.js';
import type { LaunchError } from './launch.js';

export interface MenuText {
    readonly headings: {
        readonly memory: string;
        readonly disk: string;
        readonly network: string;
        readonly address: string;
        readonly uptime: string;
        readonly forwards: string;
    };
    readonly buttons: {
        readonly retry: string;
        readonly refresh: string;
        readonly preferences: string;
    };
    copyAddress(address: string): string;
}

/** The menu's own strings, translated once; every msgid is a literal so xgettext finds it. */
export function menuText(_: Translate): MenuText {
    return {
        headings: {
            memory: _('Memory'),
            disk: _('Disk'),
            network: _('Network'),
            address: _('Address'),
            uptime: _('Uptime'),
            forwards: _('Forwards'),
        },
        buttons: {
            retry: _('Retry'),
            refresh: _('Refresh'),
            preferences: _('Preferences'),
        },
        copyAddress(address) {
            // Translators: accessible name of the button that copies an address; {address} is an
            // IP address such as "10.0.3.15".
            const template = _('Copy address {address}');
            return fill(template, { address });
        },
    };
}

/** A screen reader would read the dash as "em dash" or nothing, so it gets words instead. */
export function spokenValue(value: string, _: Translate): string {
    return value === DASH ? _('Not available') : value;
}

export function spokenRate(direction: 'down' | 'up', rate: string, _: Translate): string {
    // Whole phrases, so a translator never has to fit "Not available" into a sentence.
    if (rate === DASH)
        return direction === 'down' ? _('Download not available') : _('Upload not available');
    if (direction === 'down') {
        // Translators: spoken network download rate; {rate} is a speed such as "1.5 MB/s".
        const template = _('Download {rate}');
        return fill(template, { rate });
    }
    // Translators: spoken network upload rate; {rate} is a speed such as "1.5 MB/s".
    const template = _('Upload {rate}');
    return fill(template, { rate });
}

/** The accessible name of a row whose action is running or whose state is changing. */
export function workingName(rowName: string, _: Translate): string {
    // Translators: {name} is a row's spoken name such as "web01, Running"; the row is busy.
    const template = _('{name}, working');
    return fill(template, { name: rowName });
}

export function launchFailure(
    error: LaunchError,
    _: Translate,
): { readonly title: string; readonly message: string; readonly diagnostic?: string } {
    const title = _('Could not open a terminal');
    switch (error.kind) {
        case 'no-terminal':
            return {
                title,
                message: _('No supported terminal was found. Set one in the preferences.'),
            };
        case 'spawn-failed':
            // The detail is for the log, not for the notice.
            return {
                title,
                message: _('The terminal could not be started.'),
                diagnostic: `terminal launch failed: ${error.detail}`,
            };
        case 'invalid-name':
            return { title, message: _('This instance name cannot be used to open a terminal.') };
    }
}

/** Label of the button on a failed-action notification that opens the instance log. */
export function showLogLabel(_: Translate): string {
    return _('Show Log');
}
