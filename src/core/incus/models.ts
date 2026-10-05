// SPDX-License-Identifier: GPL-2.0-or-later

export type InstanceType = 'container' | 'virtual-machine';

export type InstanceStatus = 'running' | 'stopped' | 'frozen' | 'busy' | 'error' | 'unknown';

export interface InstanceRef {
    readonly project: string;
    readonly name: string;
}

/**
 * `cpuAllocatedNsPerSecond` and `memoryTotalBytes` are 0 when Incus does not report them;
 * `processes` is -1 when not reported (a VM without an agent).
 */
export interface InstanceState {
    readonly cpuUsageNs: number;
    readonly cpuAllocatedNsPerSecond: number;
    readonly memoryUsageBytes: number;
    readonly memoryTotalBytes: number;
    readonly rxBytes: number;
    readonly txBytes: number;
    readonly processes: number;
    readonly startedAtMs: number | null;
    readonly primaryAddress: string | null;
}

export interface Instance extends InstanceRef {
    readonly type: InstanceType;
    readonly status: InstanceStatus;
    /** Null when the list was fetched without `recursion=2`. */
    readonly state: InstanceState | null;
}

export interface Server {
    readonly version: string;
    readonly apiExtensions: ReadonlySet<string>;
}
