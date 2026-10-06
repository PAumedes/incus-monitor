// SPDX-License-Identifier: GPL-2.0-or-later
import type { IncusError } from '../errors.js';
import { err, ok, type Result } from '../result.js';

import type {
    Instance,
    InstanceState,
    InstanceStatus,
    InstanceType,
    OperationResult,
    Server,
} from './models.js';
import { isArray, isInstanceName, isProjectName, isRecord, shortened } from './validate.js';

type Decoded<T> = Result<T, IncusError>;
type Fields = Record<string, unknown>;
type Pair = readonly [number, number];

interface Limits {
    readonly min: number;
    readonly fallback: number;
}

const COUNTER = { min: 0, fallback: 0 };
// Incus reports -1 for CPU usage when a VM has no running agent.
const CPU_USAGE = { min: -1, fallback: 0 };

const IP_ADDRESS = /^[0-9A-Fa-f.:]{2,45}$/;
const VERSION = /^[\x20-\x7e]{0,32}$/;
const INSTANCE_TYPES: readonly InstanceType[] = ['container', 'virtual-machine'];

function fail(path: string, detail: string): Decoded<never> {
    return err({ kind: 'decode', path, detail });
}

// Own properties only: a daemon-controlled object must never resolve a key through its prototype.
function own(parent: Fields, key: string): unknown {
    return Object.hasOwn(parent, key) ? parent[key] : undefined;
}

function absent(value: unknown): value is null | undefined {
    return value === undefined || value === null;
}

function requiredString(
    parent: Fields,
    key: string,
    path: string,
    accepts: (value: string) => boolean,
): Decoded<string> {
    const value = own(parent, key);
    const at = `${path}.${key}`;
    if (typeof value !== 'string') return fail(at, 'expected a string');
    return accepts(value) ? ok(value) : fail(at, 'string does not match the expected format');
}

/** Absent or null reads as an empty object so callers can read its fields as zero. */
function optionalRecord(parent: Fields, key: string, path: string): Decoded<Fields> {
    const value = own(parent, key);
    if (absent(value)) return ok({});
    return isRecord(value) ? ok(value) : fail(`${path}.${key}`, 'expected an object');
}

/** Absent or null reads as `fallback`. */
function optionalNumber(
    parent: Fields,
    key: string,
    path: string,
    limits: Limits,
): Decoded<number> {
    const { min, fallback } = limits;
    const value = own(parent, key);
    if (absent(value)) return ok(fallback);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min) {
        return fail(`${path}.${key}`, `expected a finite number >= ${String(min)}`);
    }
    return ok(value);
}

function optionalCount(parent: Fields, key: string, path: string): Decoded<number> {
    // -1 is how Incus reports a VM without an agent, so it is also the "not reported" value.
    const value = optionalNumber(parent, key, path, { min: -1, fallback: -1 });
    if (value.ok && !Number.isInteger(value.value)) {
        return fail(`${path}.${key}`, 'expected an integer');
    }
    return value;
}

function numberPair(
    parent: Fields,
    path: string,
    keys: readonly [string, string],
    firstRule: Limits,
): Decoded<Pair> {
    const first = optionalNumber(parent, keys[0], path, firstRule);
    if (!first.ok) return first;
    const second = optionalNumber(parent, keys[1], path, COUNTER);
    return second.ok ? ok([first.value, second.value]) : second;
}

/** Reads two numbers from the optional sub-object `parent[key]`. */
function sectionPair(
    parent: Fields,
    key: string,
    path: string,
    keys: readonly [string, string],
    firstRule: Limits = COUNTER,
): Decoded<Pair> {
    const section = optionalRecord(parent, key, path);
    return section.ok ? numberPair(section.value, `${path}.${key}`, keys, firstRule) : section;
}

function decodeStartedAt(parent: Fields, path: string): Decoded<number | null> {
    const value = own(parent, 'started_at');
    if (absent(value)) return ok(null);
    const at = `${path}.started_at`;
    if (typeof value !== 'string') return fail(at, 'expected a timestamp string');
    const ms = Date.parse(value);
    if (Number.isNaN(ms)) return fail(at, 'unparsable timestamp');
    // Incus reports a never-started instance as year 0001, which parses to a negative time.
    return ok(ms <= 0 ? null : ms);
}

/** The first global IPv4 address; IPv6 is never used, so the readout stays short and copyable. */
function firstGlobalIPv4(entries: unknown): string | null {
    if (!isArray(entries)) return null;
    for (const entry of entries) {
        if (!isRecord(entry)) continue;
        const address = own(entry, 'address');
        if (own(entry, 'family') !== 'inet' || own(entry, 'scope') !== 'global') continue;
        if (typeof address === 'string' && IP_ADDRESS.test(address)) return address;
    }
    return null;
}

interface Network {
    readonly rxBytes: number;
    readonly txBytes: number;
    readonly address: string | null;
}

function decodeNetwork(state: Fields, path: string): Decoded<Network> {
    const network = optionalRecord(state, 'network', path);
    if (!network.ok) return network;
    const networkPath = `${path}.network`;
    let inet: string | null = null;
    let rxBytes = 0;
    let txBytes = 0;
    for (const [name, nic] of Object.entries(network.value)) {
        const nicPath = `${networkPath}.${shortened(name)}`;
        if (!isRecord(nic)) return fail(nicPath, 'expected an object');
        if (own(nic, 'type') === 'loopback') continue;
        const counters = sectionPair(nic, 'counters', nicPath, ['bytes_received', 'bytes_sent']);
        if (!counters.ok) return counters;
        rxBytes += counters.value[0];
        txBytes += counters.value[1];
        inet ??= firstGlobalIPv4(own(nic, 'addresses'));
    }
    if (!Number.isFinite(rxBytes) || !Number.isFinite(txBytes)) {
        return fail(networkPath, 'summed counters overflow');
    }
    return ok({ rxBytes, txBytes, address: inet });
}

function decodeState(state: Fields, path: string): Decoded<InstanceState> {
    const cpu = sectionPair(state, 'cpu', path, ['usage', 'allocated_time'], CPU_USAGE);
    if (!cpu.ok) return cpu;
    const memory = sectionPair(state, 'memory', path, ['usage', 'total']);
    if (!memory.ok) return memory;
    const processes = optionalCount(state, 'processes', path);
    if (!processes.ok) return processes;
    const network = decodeNetwork(state, path);
    if (!network.ok) return network;
    const startedAtMs = decodeStartedAt(state, path);
    if (!startedAtMs.ok) return startedAtMs;
    return ok({
        cpuUsageNs: cpu.value[0],
        cpuAllocatedNsPerSecond: cpu.value[1],
        memoryUsageBytes: memory.value[0],
        memoryTotalBytes: memory.value[1],
        rxBytes: network.value.rxBytes,
        txBytes: network.value.txBytes,
        processes: processes.value,
        startedAtMs: startedAtMs.value,
        primaryAddress: network.value.address,
    });
}

function statusFromCode(code: number): InstanceStatus {
    switch (code) {
        // 113 is Ready, which Incus reports for a running instance that signalled readiness.
        case 103:
        case 113:
            return 'running';
        case 102:
            return 'stopped';
        case 110:
            return 'frozen';
        case 112:
            return 'error';
        case 101:
        case 104:
        case 105:
        case 106:
        case 107:
        case 108:
        case 109:
        case 111:
            return 'busy';
        default:
            return 'unknown';
    }
}

function decodeStatus(raw: Fields, path: string): Decoded<InstanceStatus> {
    const code = own(raw, 'status_code');
    if (typeof code !== 'number' || !Number.isInteger(code)) {
        return fail(`${path}.status_code`, 'expected an integer');
    }
    return ok(statusFromCode(code));
}

function decodeType(raw: Fields, path: string): Decoded<InstanceType> {
    const value = own(raw, 'type');
    const type = INSTANCE_TYPES.find(known => known === value);
    return type === undefined
        ? fail(`${path}.type`, 'expected container or virtual-machine')
        : ok(type);
}

function decodeOptionalState(raw: Fields, path: string): Decoded<InstanceState | null> {
    const state = own(raw, 'state');
    if (absent(state)) return ok(null);
    if (!isRecord(state)) return fail(`${path}.state`, 'expected an object');
    return decodeState(state, `${path}.state`);
}

function decodeInstance(raw: unknown, path: string): Decoded<Instance> {
    if (!isRecord(raw)) return fail(path, 'expected an object');
    const project = requiredString(raw, 'project', path, isProjectName);
    if (!project.ok) return project;
    const name = requiredString(raw, 'name', path, isInstanceName);
    if (!name.ok) return name;
    const type = decodeType(raw, path);
    if (!type.ok) return type;
    const status = decodeStatus(raw, path);
    if (!status.ok) return status;
    const state = decodeOptionalState(raw, path);
    if (!state.ok) return state;
    return ok({
        project: project.value,
        name: name.value,
        type: type.value,
        status: status.value,
        state: state.value,
    });
}

export function decodeInstances(metadata: unknown): Decoded<readonly Instance[]> {
    if (!isArray(metadata)) return fail('metadata', 'expected an array');
    const instances: Instance[] = [];
    for (const [index, raw] of metadata.entries()) {
        const instance = decodeInstance(raw, `metadata[${String(index)}]`);
        if (!instance.ok) return instance;
        instances.push(instance.value);
    }
    return ok(instances);
}

function decodeVersion(metadata: Fields): Decoded<string> {
    const environment = own(metadata, 'environment');
    if (!isRecord(environment)) return fail('metadata.environment', 'expected an object');
    return requiredString(environment, 'server_version', 'metadata.environment', value =>
        VERSION.test(value),
    );
}

function decodeApiExtensions(metadata: Fields): Decoded<ReadonlySet<string>> {
    const path = 'metadata.api_extensions';
    const list = own(metadata, 'api_extensions');
    if (!isArray(list)) return fail(path, 'expected an array');
    const extensions = new Set<string>();
    for (const [index, extension] of list.entries()) {
        if (typeof extension !== 'string') {
            return fail(`${path}[${String(index)}]`, 'expected a string');
        }
        extensions.add(extension);
    }
    return ok(extensions);
}

export function decodeServer(metadata: unknown): Decoded<Server> {
    if (!isRecord(metadata)) return fail('metadata', 'expected an object');
    const version = decodeVersion(metadata);
    if (!version.ok) return version;
    const apiExtensions = decodeApiExtensions(metadata);
    if (!apiExtensions.ok) return apiExtensions;
    return ok({ version: version.value, apiExtensions: apiExtensions.value });
}

/** Absent or null `err` reads as "": Incus leaves it empty on success. */
export function decodeOperationResult(metadata: unknown): Decoded<OperationResult> {
    if (!isRecord(metadata)) return fail('metadata', 'expected an object');
    const code = own(metadata, 'status_code');
    if (typeof code !== 'number' || !Number.isInteger(code)) {
        return fail('metadata.status_code', 'expected an integer');
    }
    const message = own(metadata, 'err');
    if (absent(message)) return ok({ statusCode: code, error: '' });
    if (typeof message !== 'string') return fail('metadata.err', 'expected a string');
    return ok({ statusCode: code, error: message });
}
