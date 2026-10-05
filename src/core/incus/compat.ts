// SPDX-License-Identifier: GPL-2.0-or-later
import type { IncusError } from '../errors.js';
import { err, ok, type Result } from '../result.js';
import type { Server } from './models.js';

// Feature detection, not version checks, so the gate works across Incus 6.0 and 7.0.
export const REQUIRED_EXTENSIONS: readonly string[] = [
    'instance_all_projects',
    'container_full',
    'instance_state_cpu_time',
    'instance_state_started_at',
];

export function checkCompat(server: Server): Result<Server, IncusError> {
    const missing = REQUIRED_EXTENSIONS.filter(name => !server.apiExtensions.has(name));
    return missing.length === 0
        ? ok(server)
        : err({ kind: 'unsupported', reason: `missing API extensions: ${missing.join(', ')}` });
}
