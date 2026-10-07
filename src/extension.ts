// SPDX-License-Identifier: GPL-2.0-or-later
import GLib from 'gi://GLib';

import {
    Extension,
    gettext as _,
    ngettext,
} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import { GioLauncher } from './adapters/launcher.js';
import { GioSettings } from './adapters/settings.js';
import { GioSocketProbe } from './adapters/socket-probe.js';
import { GioTransport } from './adapters/gio-transport.js';
import { GLibClock } from './adapters/glib-clock.js';
import { Formatter, formatCount } from './core/format.js';
import type { InstanceAction } from './core/incus/actions.js';
import { IncusClient } from './core/incus/client.js';
import { instanceKey, type Instance } from './core/incus/models.js';
import { launchFailure, menuText, showLogLabel } from './core/menu-text.js';
import type { LaunchTarget } from './core/launch.js';
import { knownInstances, Monitor, type Snapshot } from './core/monitor.js';
import { monitorSettings } from './core/monitor-settings.js';
import { ExitWatch } from './core/exit-watch.js';
import { failureNotice, present, stoppedNotice, type TerminalTarget } from './core/presenter.js';
import { Sampler } from './core/sampler.js';
import { NoticeSource, ReplaceableNotice } from './ui/replaceable-notice.js';
import { Indicator } from './ui/indicator.js';

/** Everything `enable()` creates, so `disable()` can release it as one unit. */
interface Session {
    readonly settings: GioSettings;
    readonly clock: GLibClock;
    readonly probe: GioSocketProbe;
    readonly launcher: GioLauncher;
    readonly sampler: Sampler;
    readonly formatter: Formatter;
    readonly locale: string;
    readonly indicator: Indicator;
    readonly noticeSource: NoticeSource;
    readonly notice: ReplaceableNotice;
    // A separate slot, so a stop never replaces a pending failure of an action.
    readonly stopNotice: ReplaceableNotice;
    readonly exitWatch: ExitWatch;
    // Keys with a menu action in flight: their stops are expected and not reported.
    readonly actionsInFlight: Set<string>;
    readonly unsubscribe: () => void;
    monitor: Monitor | undefined;
    // The last snapshot, so a presentation-only setting can redraw without a new request.
    lastSnapshot: Snapshot | undefined;
    disposed: boolean;
}

export default class IncusMonitorExtension extends Extension {
    #session: Session | null = null;

    override enable(): void {
        const settings = new GioSettings(this.getSettings());
        const clock = new GLibClock();
        const noticeSource = new NoticeSource();
        let indicator: Indicator | undefined;
        let unsubscribe = (): void => undefined;
        try {
            const locale = GLib.get_language_names()[0] ?? 'C';
            indicator = new Indicator({
                text: menuText(_),
                formatCount: value => formatCount(value, locale),
                onOpenChanged: open => {
                    this.#session?.monitor?.setMenuOpen(open);
                },
                perform: (action, key) => this.#perform(action, key),
                openTerminal: (target, key) => {
                    this.#openTerminal(target, key);
                },
                refresh: () => {
                    this.#session?.monitor?.refresh();
                },
                openPreferences: () => {
                    this.openPreferences();
                },
            });
            // Only presentation settings change at runtime: the refresh interval is read live by
            // the monitor and the terminal at launch. The INCUS_SOCKET override is read once, here.
            unsubscribe = settings.subscribe(() => {
                this.#renderLast();
            });
            const session: Session = {
                settings,
                clock,
                probe: new GioSocketProbe(),
                launcher: new GioLauncher(),
                sampler: new Sampler(),
                // Unit templates are translated once here, so a language change applies on the next enable.
                formatter: new Formatter(locale, _),
                locale,
                indicator,
                noticeSource,
                notice: new ReplaceableNotice(noticeSource),
                stopNotice: new ReplaceableNotice(noticeSource),
                exitWatch: new ExitWatch(),
                actionsInFlight: new Set(),
                unsubscribe,
                monitor: undefined,
                lastSnapshot: undefined,
                disposed: false,
            };
            this.#session = session;
            Main.panel.addToStatusArea(this.uuid, indicator.actor);
            session.monitor = this.#createMonitor(session);
            session.monitor.start();
        } catch (error) {
            if (this.#session !== null) {
                this.#session.notice.dispose();
                this.#session.stopNotice.dispose();
                this.#disposeMonitor(this.#session);
            }
            this.#session = null;
            unsubscribe();
            indicator?.destroy();
            clock.dispose();
            settings.dispose();
            throw error;
        }
    }

    override disable(): void {
        const session = this.#session;
        this.#session = null;
        if (session === null) return;
        session.disposed = true;
        session.unsubscribe();
        session.indicator.destroy();
        session.notice.dispose();
        session.stopNotice.dispose();
        session.noticeSource.dispose();
        session.clock.dispose();
        session.settings.dispose();
        // Last: cancelling in-flight work rethrows what a cancel listener throws.
        this.#disposeMonitor(session);
    }

    #createMonitor(session: Session): Monitor {
        return new Monitor({
            connect: path => new IncusClient(new GioTransport(path, session.clock)),
            probe: session.probe,
            clock: session.clock,
            settings: monitorSettings(session.settings, name => GLib.getenv(name)),
            // The monitor sanitises its own messages, so the port passes them through untouched.
            log: {
                warn: message => {
                    console.warn(message);
                },
            },
            onSnapshot: snapshot => {
                if (session.disposed) return;
                session.sampler.record(snapshot);
                session.lastSnapshot = snapshot;
                this.#render(session, snapshot);
                this.#reportStops(session, snapshot);
            },
        });
    }

    #reportStops(session: Session, snapshot: Snapshot): void {
        const stopped = session.exitWatch.observe(snapshot, session.actionsInFlight);
        if (stopped.length === 0) return;
        const { title, message } = stoppedNotice(stopped, _, ngettext, session.locale);
        session.stopNotice.show('stopped', title, message);
    }

    #disposeMonitor(session: Session): void {
        try {
            session.monitor?.dispose();
        } catch (error) {
            console.warn(`Incus Monitor: disposing the monitor failed: ${String(error)}`);
        }
        session.monitor = undefined;
    }

    #render(session: Session, snapshot: Snapshot): void {
        const viewModel = present(snapshot, {
            formatter: session.formatter,
            locale: session.locale,
            translate: _,
            ngettext,
            samples: session.sampler,
            wallNowMs: Date.now(),
            showStopped: session.settings.showStoppedInstances,
        });
        session.indicator.render(viewModel, session.settings.showRunningCount);
    }

    #renderLast(): void {
        const session = this.#session;
        if (session?.lastSnapshot !== undefined) this.#render(session, session.lastSnapshot);
    }

    #find(key: string): Instance | undefined {
        const state = this.#session?.monitor?.state;
        if (state === undefined) return undefined;
        return (knownInstances(state) ?? []).find(instance => instanceKey(instance) === key);
    }

    async #perform(action: InstanceAction, key: string): Promise<void> {
        const session = this.#session;
        const instance = this.#find(key);
        if (session?.monitor === undefined || instance === undefined) return;
        session.actionsInFlight.add(key);
        const result = await session.monitor.perform(action, instance).finally(() => {
            session.actionsInFlight.delete(key);
        });
        // A disable and re-enable during the wait leaves a different session: say nothing then.
        if (this.#session !== session) return;
        if (result.ok) {
            session.notice.clear(key);
            return;
        }
        const notice = failureNotice(action, instance.name, result.error, _);
        if (notice === null) return;
        const logAction = notice.offersLog
            ? {
                  label: showLogLabel(_),
                  run: () => {
                      if (!session.disposed) this.#launch(session, 'log', instance);
                  },
              }
            : undefined;
        session.notice.show(key, notice.title, notice.message, logAction);
    }

    #openTerminal(target: TerminalTarget, key: string): void {
        const session = this.#session;
        const instance = this.#find(key);
        if (session === null || instance === undefined) return;
        this.#launch(session, target, instance);
    }

    #launch(session: Session, kind: LaunchTarget['kind'], instance: Instance): void {
        const launched = session.launcher.launch(
            { kind, name: instance.name, project: instance.project },
            session.settings.terminalCommand,
        );
        if (launched.ok) return;
        const { title, message } = launchFailure(launched.error, _);
        Main.notify(title, message);
    }
}
