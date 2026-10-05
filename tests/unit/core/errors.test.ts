// SPDX-License-Identifier: GPL-2.0-or-later
import { describe, expectTypeOf, it } from 'vitest';

import type { IncusError } from '../../../src/core/errors.js';

type Of<K extends IncusError['kind']> = Extract<IncusError, { kind: K }>;

// These are compile-time checks: `npm run typecheck` is what proves them.
describe('IncusError', () => {
    it('has exactly the nine documented kinds', () => {
        expectTypeOf<IncusError['kind']>().toEqualTypeOf<
            | 'not-installed'
            | 'permission-denied'
            | 'unreachable'
            | 'timeout'
            | 'cancelled'
            | 'protocol'
            | 'decode'
            | 'api'
            | 'unsupported'
        >();
    });

    it('carries no data for the kinds that need none', () => {
        expectTypeOf<Of<'not-installed'>>().toEqualTypeOf<{ readonly kind: 'not-installed' }>();
        expectTypeOf<Of<'permission-denied'>>().toEqualTypeOf<{
            readonly kind: 'permission-denied';
        }>();
        expectTypeOf<Of<'unreachable'>>().toEqualTypeOf<{ readonly kind: 'unreachable' }>();
        expectTypeOf<Of<'timeout'>>().toEqualTypeOf<{ readonly kind: 'timeout' }>();
        expectTypeOf<Of<'cancelled'>>().toEqualTypeOf<{ readonly kind: 'cancelled' }>();
    });

    it('carries only the data each kind needs', () => {
        expectTypeOf<Of<'protocol'>>().toEqualTypeOf<{
            readonly kind: 'protocol';
            readonly detail: string;
        }>();
        expectTypeOf<Of<'decode'>>().toEqualTypeOf<{
            readonly kind: 'decode';
            readonly path: string;
            readonly detail: string;
        }>();
        expectTypeOf<Of<'api'>>().toEqualTypeOf<{
            readonly kind: 'api';
            readonly code: number;
            readonly message: string;
        }>();
        expectTypeOf<Of<'unsupported'>>().toEqualTypeOf<{
            readonly kind: 'unsupported';
            readonly reason: string;
        }>();
    });
});
