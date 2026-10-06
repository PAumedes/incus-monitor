// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expect, it } from 'vitest';

import { monitorSettings } from '../../../src/core/monitor-settings.js';

const noEnv = (): string | null => null;

describe('monitorSettings', () => {
    it('reads the refresh interval live from the source', () => {
        const source = { refreshIntervalSeconds: 10 };
        const settings = monitorSettings(source, noEnv);
        source.refreshIntervalSeconds = 30;
        expect(settings.refreshIntervalSeconds).toBe(30);
    });

    it('takes the socket override from INCUS_SOCKET', () => {
        const asked: string[] = [];
        const settings = monitorSettings({ refreshIntervalSeconds: 10 }, name => {
            asked.push(name);
            return '/tmp/custom.socket';
        });
        expect(settings.socketOverride).toBe('/tmp/custom.socket');
        expect(new Set(asked)).toEqual(new Set(['INCUS_SOCKET']));
    });

    it('maps an unset variable (null) to undefined', () => {
        expect(
            monitorSettings({ refreshIntervalSeconds: 10 }, noEnv).socketOverride,
        ).toBeUndefined();
    });
});
