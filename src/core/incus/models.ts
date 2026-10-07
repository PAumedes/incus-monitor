// SPDX-License-Identifier: GPL-2.0-or-later

export type InstanceType = 'container' | 'virtual-machine';

export type InstanceStatus = 'running' | 'stopped' | 'frozen' | 'busy' | 'error' | 'unknown';

export interface InstanceRef {
    readonly project: string;
    readonly name: string;
}

export interface DiskUsage {
    readonly usageBytes: number;
    readonly totalBytes: number;
}

/**
 * `cpuAllocatedNsPerSecond`, `memoryTotalBytes` and `disk.totalBytes` are 0 when Incus does not
 * report them; `processes` and `cpuUsageNs` are -1 when not available (a VM without an agent).
 * `primaryAddress` is the first global IPv4 address of a non-loopback interface, never IPv6.
 */
export interface InstanceState {
    readonly cpuUsageNs: number;
    readonly cpuAllocatedNsPerSecond: number;
    readonly memoryUsageBytes: number;
    readonly memoryTotalBytes: number;
    /** Null when the pool reports no root usage (`dir`) or Incus cannot measure it. */
    readonly disk: DiskUsage | null;
    readonly rxBytes: number;
    readonly txBytes: number;
    readonly processes: number;
    readonly startedAtMs: number | null;
    readonly primaryAddress: string | null;
}

export interface PortRange {
    readonly first: number;
    readonly last: number;
}

/** A host-bound `proxy` device that connects into the instance, tcp or udp only. */
export type Protocol = 'tcp' | 'udp';

export interface Forward {
    readonly protocol: Protocol;
    readonly listen: PortRange;
    readonly connect: PortRange;
}

/** Stable identity of an instance across projects. */
export const instanceKey = (ref: InstanceRef): string => `${ref.project}/${ref.name}`;

export interface Instance extends InstanceRef {
    readonly type: InstanceType;
    readonly status: InstanceStatus;
    /** Null when the list was fetched without `recursion=2`. */
    readonly state: InstanceState | null;
    /** Configuration, so it is known whatever the status; in device-key order, at most 64. */
    readonly forwards: readonly Forward[];
}

export interface Server {
    readonly version: string;
    readonly apiExtensions: ReadonlySet<string>;
}

/** The parts of an operation's final metadata the client acts on. `error` is "" on success. */
export interface OperationResult {
    readonly statusCode: number;
    readonly error: string;
}
