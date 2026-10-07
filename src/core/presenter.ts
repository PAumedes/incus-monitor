// SPDX-License-Identifier: GPL-2.0-or-later
import type { IncusError } from './errors.js';
import {
    DASH,
    fill,
    formatCount,
    formatList,
    formatPort,
    intlLocale,
    type Formatter,
    type Translate,
} from './format.js';
import { actionsFor, type InstanceAction } from './incus/actions.js';
import {
    instanceKey,
    type Forward,
    type Instance,
    type PortRange,
    type InstanceRef,
    type InstanceStatus,
    type InstanceType,
} from './incus/models.js';
import { userMessage } from './incus/validate.js';
import type { LaunchTarget } from './launch.js';
import type { Snapshot } from './monitor.js';
import type { LiveRates } from './sampler.js';

export interface PresentContext {
    readonly formatter: Formatter;
    readonly locale: string;
    readonly translate: Translate;
    readonly ngettext: (singular: string, plural: string, n: number) => string;
    readonly samples: { rates(ref: InstanceRef): LiveRates };
    /** Wall-clock time, unlike `Snapshot.atMs`: uptime is measured against Incus' start time. */
    readonly wallNowMs: number;
    readonly showStopped: boolean;
}

/** The row's terminal buttons; the log target opens from a failure notification instead. */
export type TerminalTarget = Exclude<LaunchTarget['kind'], 'log'>;

export type RowAction =
    | {
          readonly kind: 'lifecycle';
          readonly action: InstanceAction;
          readonly label: string;
          readonly icon: string;
      }
    | { readonly kind: 'terminal'; readonly target: TerminalTarget; readonly label: string };

export type DotClass = 'running' | 'frozen' | 'stopped' | 'error';

export interface RowDetails {
    readonly memory: string;
    /** Null when the instance's pool reports no disk usage. */
    readonly disk: string | null;
    readonly network: { readonly down: string; readonly up: string };
    readonly address: string;
    readonly uptime: string;
}

export interface Row {
    readonly key: string;
    readonly name: string;
    /** Null while every visible instance is in one project. */
    readonly project: string | null;
    readonly typeIcon: string;
    readonly dot: DotClass;
    readonly statusText: string;
    readonly accessibleName: string;
    readonly busy: boolean;
    readonly readout: { readonly cpu: string; readonly memory: string } | null;
    readonly actions: readonly RowAction[];
    readonly details: RowDetails | null;
    /** Null when the instance forwards no ports. */
    readonly forwards: string | null;
    /** The same forwards as a sentence for a screen reader; null exactly when `forwards` is. */
    readonly forwardsSpoken: string | null;
}

interface PanelState {
    readonly panelIcon: string;
    readonly panelAccessibleName: string;
}

export type ViewModel =
    | ({
          readonly kind: 'list';
          readonly rows: readonly Row[];
          readonly runningCount: number;
          /** Null for a single instance: "1 of 1 running" says nothing. */
          readonly summary: string | null;
      } & PanelState)
    | ({
          readonly kind: 'notice';
          readonly text: string;
          readonly action: 'retry' | null;
      } & PanelState)
    | ({ readonly kind: 'loading' } & PanelState);

const PANEL_ICON = 'package-x-generic-symbolic';
const WARNING_ICON = 'dialog-warning-symbolic';

const TYPE_ICONS: Readonly<Record<InstanceType, string>> = {
    container: 'package-x-generic-symbolic',
    'virtual-machine': 'computer-symbolic',
};

const ACTION_ICONS: Readonly<Record<InstanceAction, string>> = {
    start: 'media-playback-start-symbolic',
    unfreeze: 'media-playback-start-symbolic',
    stop: 'media-playback-stop-symbolic',
    restart: 'system-reboot-symbolic',
    freeze: 'media-playback-pause-symbolic',
};

// Busy and unknown borrow the nearest neutral dot: the status word carries the difference.
const DOTS: Readonly<Record<InstanceStatus, DotClass>> = {
    running: 'running',
    frozen: 'frozen',
    stopped: 'stopped',
    error: 'error',
    busy: 'frozen',
    unknown: 'stopped',
};

const MAX_SHOWN_FORWARDS = 3;

const STATUS_ORDER: Readonly<Record<InstanceStatus, number>> = {
    running: 0,
    frozen: 1,
    stopped: 2,
    unknown: 3,
    error: 4,
    busy: 5,
};

function statusText(status: InstanceStatus, _: Translate): string {
    switch (status) {
        case 'running':
            return _('Running');
        case 'frozen':
            return _('Frozen');
        case 'stopped':
            return _('Stopped');
        case 'busy':
            return _('Busy');
        case 'error':
            return _('Error');
        case 'unknown':
            return _('Unknown');
    }
}

function lifecycleLabel(action: InstanceAction, _: Translate): string {
    switch (action) {
        case 'start':
            return _('Start');
        case 'stop':
            return _('Stop');
        case 'restart':
            return _('Restart');
        case 'freeze':
            return _('Freeze');
        case 'unfreeze':
            return _('Unfreeze');
    }
}

function terminalTarget(instance: Instance): TerminalTarget | null {
    if (instance.type !== 'virtual-machine') return 'shell';
    // Without state the guest agent is unknown, so neither terminal can be promised.
    if (instance.state === null) return null;
    // A VM without a guest agent reports no process count, and only the console reaches it.
    return instance.state.processes < 0 ? 'console' : 'shell';
}

function actionsOf(instance: Instance, _: Translate): RowAction[] {
    const actions: RowAction[] = actionsFor(instance.status).map(action => ({
        kind: 'lifecycle',
        action,
        label: lifecycleLabel(action, _),
        icon: ACTION_ICONS[action],
    }));
    if (instance.status !== 'running') return actions;
    const target = terminalTarget(instance);
    if (target === 'shell') actions.push({ kind: 'terminal', target, label: _('Open Shell') });
    if (target === 'console') actions.push({ kind: 'terminal', target, label: _('Open Console') });
    return actions;
}

function sizeText(used: number, total: number, ctx: PresentContext): string {
    const usedText = ctx.formatter.bytes(used);
    if (total <= 0) return usedText;
    const _ = ctx.translate;
    // Translators: {used} and {total} are sizes such as "246 MB" and "2.0 GB".
    const template = _('{used} of {total}');
    return fill(template, { used: usedText, total: ctx.formatter.bytes(total) });
}

function detailsOf(instance: Instance, rates: LiveRates, ctx: PresentContext): RowDetails | null {
    const state = instance.state;
    if (instance.status !== 'running' || state === null) return null;
    const { formatter } = ctx;
    const uptimeMs = state.startedAtMs === null ? -1 : ctx.wallNowMs - state.startedAtMs;
    return {
        memory: sizeText(state.memoryUsageBytes, state.memoryTotalBytes, ctx),
        disk:
            state.disk === null
                ? null
                : sizeText(state.disk.usageBytes, state.disk.totalBytes, ctx),
        network: rates.network
            ? {
                  down: formatter.rate(rates.network.rxBytesPerSecond),
                  up: formatter.rate(rates.network.txBytesPerSecond),
              }
            : { down: DASH, up: DASH },
        address: state.primaryAddress ?? DASH,
        uptime: uptimeMs >= 0 ? formatter.duration(uptimeMs) : DASH,
    };
}

function portsText({ first, last }: PortRange, locale: string): string {
    const from = formatPort(first, locale);
    return first === last ? from : `${from}-${formatPort(last, locale)}`;
}

function spokenPorts({ first, last }: PortRange, ctx: PresentContext): string {
    const from = formatPort(first, ctx.locale);
    if (first === last) return from;
    const _ = ctx.translate;
    // Translators: a port range read aloud; {first} and {last} are port numbers such as "8000".
    const template = _('{first} to {last}');
    return fill(template, { first: from, last: formatPort(last, ctx.locale) });
}

function spokenForward(forward: Forward, ctx: PresentContext): string {
    const { ngettext } = ctx;
    const template = ngettext(
        // Translators: read aloud, as in "TCP port 80 forwarded to 8080". {protocol} is TCP or
        // UDP; the form follows the number of host ports.
        '{protocol} port {listen} forwarded to {target}',
        '{protocol} ports {listen} forwarded to {target}',
        forward.listen.last - forward.listen.first + 1,
    );
    return fill(template, {
        protocol: forward.protocol.toUpperCase(),
        listen: spokenPorts(forward.listen, ctx),
        target: spokenPorts(forward.connect, ctx),
    });
}

function forwardsOf(
    forwards: readonly Forward[],
    ctx: PresentContext,
): Pick<Row, 'forwards' | 'forwardsSpoken'> {
    if (forwards.length === 0) return { forwards: null, forwardsSpoken: null };
    const shown = forwards.slice(0, MAX_SHOWN_FORWARDS);
    const lines = shown.map(
        f =>
            `${f.protocol} ${portsText(f.listen, ctx.locale)} → ${portsText(f.connect, ctx.locale)}`,
    );
    const spoken = shown.map(f => spokenForward(f, ctx));
    const hidden = forwards.length - shown.length;
    if (hidden > 0) {
        const count = formatCount(hidden, ctx.locale);
        // Translators: {count} is how many more port forwards exist than are listed. Both forms
        // are identical on purpose: the count is a placeholder.
        const more = ctx.ngettext('+{count} more', '+{count} more', hidden);
        lines.push(fill(more, { count }));
        // Translators: read aloud after the listed port forwards; {count} is how many more there
        // are. Both forms are identical on purpose: the count is a placeholder.
        const spokenMore = ctx.ngettext('{count} more', '{count} more', hidden);
        spoken.push(fill(spokenMore, { count }));
    }
    return {
        forwards: formatList(lines, ctx.locale),
        forwardsSpoken: formatList(spoken, ctx.locale),
    };
}

function accessibleName(instance: Instance, status: string, showProject: boolean, _: Translate) {
    const values = { name: instance.name, project: instance.project, status };
    if (showProject) {
        // Translators: {name} is an instance, {project} its Incus project, {status} its state.
        const template = _('{name}, {project}, {status}');
        return fill(template, values);
    }
    // Translators: {name} is an instance and {status} its state, such as "Running".
    const template = _('{name}, {status}');
    return fill(template, values);
}

function rowOf(instance: Instance, showProject: boolean, ctx: PresentContext): Row {
    const rates = ctx.samples.rates(instance);
    const status = statusText(instance.status, ctx.translate);
    const state = instance.state;
    return {
        key: instanceKey(instance),
        name: instance.name,
        project: showProject ? instance.project : null,
        typeIcon: TYPE_ICONS[instance.type],
        dot: DOTS[instance.status],
        statusText: status,
        accessibleName: accessibleName(instance, status, showProject, ctx.translate),
        busy: instance.status === 'busy',
        readout:
            instance.status === 'running' && state !== null
                ? {
                      cpu: ctx.formatter.percent(rates.cpuPercent),
                      memory: ctx.formatter.bytes(state.memoryUsageBytes),
                  }
                : null,
        actions: actionsOf(instance, ctx.translate),
        details: detailsOf(instance, rates, ctx),
        ...forwardsOf(instance.forwards, ctx),
    };
}

const compareCodeUnits = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function sorted(instances: readonly Instance[], locale: string): Instance[] {
    // Base sensitivity folds case and accents, as the collation of a name list is expected to.
    const collator = new Intl.Collator(intlLocale(locale), { sensitivity: 'base' });
    return [...instances].sort(
        (a, b) =>
            STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
            collator.compare(a.name, b.name) ||
            collator.compare(a.project, b.project) ||
            // Case-only differences compare equal above; code unit order keeps the result stable.
            compareCodeUnits(a.name, b.name) ||
            compareCodeUnits(a.project, b.project),
    );
}

// xgettext only sees calls spelled `_(...)`, so every caller reaches the translation through here.
function panelName(ctx: PresentContext): string {
    const _ = ctx.translate;
    return _('Incus');
}

function loading(ctx: PresentContext): ViewModel {
    return { kind: 'loading', panelIcon: PANEL_ICON, panelAccessibleName: panelName(ctx) };
}

function notice(text: string, action: 'retry' | null, ctx: PresentContext): ViewModel {
    return {
        kind: 'notice',
        text,
        action,
        panelIcon: PANEL_ICON,
        panelAccessibleName: panelName(ctx),
    };
}

interface Explanation {
    readonly text: string;
    readonly retry: boolean;
}

// One sentence per cause that the user can act on; every other failure reads as "not responding".
function explain(error: IncusError, _: Translate): Explanation {
    switch (error.kind) {
        case 'not-installed':
            return { text: _('Incus is not installed'), retry: false };
        case 'permission-denied':
            return {
                text: _('Add your user to the “incus” group, then log in again'),
                retry: false,
            };
        case 'unsupported':
            return { text: _('Incus 6.0 or later is required'), retry: false };
        case 'cancelled':
        case 'unreachable':
        case 'timeout':
        case 'protocol':
        case 'decode':
        case 'api':
            return { text: _('Incus is not responding'), retry: true };
    }
}

function failureView(error: IncusError, ctx: PresentContext): ViewModel {
    if (error.kind === 'cancelled') return loading(ctx);
    const { text, retry } = explain(error, ctx.translate);
    return {
        kind: 'notice',
        text,
        action: retry ? 'retry' : null,
        panelIcon: WARNING_ICON,
        panelAccessibleName: text,
    };
}

function runningPanelName(runningCount: number, ctx: PresentContext): string {
    const { ngettext } = ctx;
    // Translators: {count} is the number of running instances. Both forms are identical on purpose:
    // the count is a placeholder, so the plural form changes nothing in the sentence.
    const template = ngettext('Incus, {count} running', 'Incus, {count} running', runningCount);
    return fill(template, { count: formatCount(runningCount, ctx.locale) });
}

function summaryOf(runningCount: number, total: number, ctx: PresentContext): string | null {
    if (total === 1) return null;
    const { ngettext } = ctx;
    // Translators: {running} and {total} are instance counts, as in "2 of 5 running". Both forms
    // are identical on purpose: the numbers are placeholders.
    const template = ngettext(
        '{running} of {total} running',
        '{running} of {total} running',
        total,
    );
    return fill(template, {
        running: formatCount(runningCount, ctx.locale),
        total: formatCount(total, ctx.locale),
    });
}

function listOf(instances: readonly Instance[], ctx: PresentContext): ViewModel {
    const _ = ctx.translate;
    if (instances.length === 0) return notice(_('No instances'), null, ctx);
    const visible = sorted(instances, ctx.locale).filter(
        i => ctx.showStopped || i.status !== 'stopped',
    );
    if (visible.length === 0) return notice(_('No running instances'), null, ctx);
    const showProject = new Set(visible.map(i => i.project)).size > 1;
    const runningCount = instances.filter(i => i.status === 'running').length;
    return {
        kind: 'list',
        rows: visible.map(i => rowOf(i, showProject, ctx)),
        runningCount,
        summary: summaryOf(runningCount, instances.length, ctx),
        panelIcon: PANEL_ICON,
        panelAccessibleName: runningPanelName(runningCount, ctx),
    };
}

/**
 * Maps a snapshot to what the menu shows. Run `Sampler.record(snapshot)` first, so the rates the
 * rows read already include this snapshot.
 */
export function present(snapshot: Snapshot, ctx: PresentContext): ViewModel {
    switch (snapshot.kind) {
        case 'idle':
        case 'connecting':
            return loading(ctx);
        case 'ready':
            return listOf(snapshot.instances, ctx);
        case 'refreshing':
            return listOf(snapshot.previous, ctx);
        case 'failed':
            return failureView(snapshot.error, ctx);
    }
}

/** Title of the notification for a failed action. */
export function performFailureTitle(
    action: InstanceAction,
    name: string,
    translate: Translate,
): string {
    const _ = translate;
    switch (action) {
        case 'start':
            // Translators: {name} is the instance the action was run on.
            return fill(_('Could not start {name}'), { name });
        case 'stop':
            // Translators: {name} is the instance the action was run on.
            return fill(_('Could not stop {name}'), { name });
        case 'restart':
            // Translators: {name} is the instance the action was run on.
            return fill(_('Could not restart {name}'), { name });
        case 'freeze':
            // Translators: {name} is the instance the action was run on.
            return fill(_('Could not freeze {name}'), { name });
        case 'unfreeze':
            // Translators: {name} is the instance the action was run on.
            return fill(_('Could not unfreeze {name}'), { name });
    }
}

/** Whether the instance's log may explain this failure: the daemon answered or stalled on it. */
export function offersLog(error: IncusError): boolean {
    switch (error.kind) {
        case 'api':
        case 'timeout':
            return true;
        case 'protocol':
        case 'decode':
        case 'not-installed':
        case 'permission-denied':
        case 'unreachable':
        case 'unsupported':
        case 'cancelled':
            return false;
    }
}

/** The whole failure notification for an action, or null when nothing should be shown. */
export function failureNotice(
    action: InstanceAction,
    instanceName: string,
    error: IncusError,
    translate: Translate,
): { readonly title: string; readonly message: string; readonly offersLog: boolean } | null {
    const message = performFailureMessage(error, translate);
    if (message === null) return null;
    return {
        title: performFailureTitle(action, instanceName, translate),
        message,
        offersLog: offersLog(error),
    };
}

/** Body of the notification for a failed action, or null when nothing should be shown. */
export function performFailureMessage(error: IncusError, translate: Translate): string | null {
    const _ = translate;
    switch (error.kind) {
        case 'cancelled':
            return null;
        // The Incus message is the one thing the user needs to see, but it is daemon-supplied.
        case 'api': {
            const message = userMessage(error.message).trim();
            return message === '' ? _('The action failed') : message;
        }
        // The reason is a diagnostic string, not UI text.
        case 'unsupported':
            return _('This action is not available for this instance');
        case 'not-installed':
        case 'permission-denied':
            return explain(error, _).text;
        // The request may have reached the daemon, so the outcome is unknown.
        case 'unreachable':
        case 'timeout':
        case 'protocol':
        case 'decode':
            return _('Could not confirm the result. Check the instance state.');
    }
}

const MAX_STOPPED_NAMES = 3;

/** The notification for running instances that stopped without a menu action. */
export function stoppedNotice(
    instances: readonly Instance[],
    _: Translate,
    ngettext: PresentContext['ngettext'],
    locale: string,
): { readonly title: string; readonly message: string } {
    const [only] = instances;
    if (instances.length === 1 && only !== undefined) {
        const template =
            only.status === 'error'
                ? // Translators: {name} is the name of an instance.
                  _('{name} is in an error state.')
                : // Translators: {name} is the name of an instance.
                  _('{name} is no longer running.');
        return {
            title: _('Instance not running'),
            message: fill(template, { name: only.name }),
        };
    }
    const names = instances.slice(0, MAX_STOPPED_NAMES).map(i => i.name);
    const hidden = instances.length - names.length;
    if (hidden > 0) {
        // Translators: {count} is how many more stopped instances exist than are named. Both forms
        // are identical on purpose: the count is a placeholder.
        names.push(
            fill(ngettext('+{count} more', '+{count} more', hidden), {
                count: formatCount(hidden, locale),
            }),
        );
    }
    const title = ngettext(
        // Translators: {count} is how many instances are not running. Both forms are identical on
        // purpose: the count is a placeholder.
        '{count} instances not running',
        '{count} instances not running',
        instances.length,
    );
    return {
        title: fill(title, { count: formatCount(instances.length, locale) }),
        message: names.join(', '),
    };
}
