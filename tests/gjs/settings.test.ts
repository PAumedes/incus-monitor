// SPDX-License-Identifier: GPL-2.0-or-later
// GioSettings over the real schema compiled into a temp directory, on the in-memory backend so
// the user's dconf database is never touched.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import { GioSettings } from '../../src/adapters/settings.js';
import { assert, test } from './harness.js';
import { collectingWarnings, run, withTempDir } from './support.js';

const SCHEMA_ID = 'org.gnome.shell.extensions.incus-monitor';
const SCHEMA_SOURCE_DIR = `${GLib.get_current_dir()}/data/schemas`;

async function withSettings(
    body: (wrapper: GioSettings, raw: Gio.Settings) => void | Promise<void>,
): Promise<void> {
    await withTempDir(async dir => {
        run(['cp', `${SCHEMA_SOURCE_DIR}/${SCHEMA_ID}.gschema.xml`, dir]);
        run(['glib-compile-schemas', dir]);
        const source = Gio.SettingsSchemaSource.new_from_directory(
            dir,
            Gio.SettingsSchemaSource.get_default(),
            false,
        );
        const schema = source.lookup(SCHEMA_ID, false);
        assert.ok(schema, 'schema must compile');
        const raw = Gio.Settings.new_full(schema, Gio.memory_settings_backend_new(), null);
        const wrapper = new GioSettings(raw);
        try {
            await body(wrapper, raw);
        } finally {
            wrapper.dispose();
        }
    });
}

test('settings: defaults match the schema', () =>
    withSettings(settings => {
        assert.equal(settings.refreshIntervalSeconds, 10);
        assert.equal(settings.showRunningCount, true);
        assert.equal(settings.showStoppedInstances, true);
        assert.deepEqual(settings.terminalCommand, []);
    }));

test('settings: getters read the current values live', () =>
    withSettings((settings, raw) => {
        raw.set_uint('refresh-interval', 30);
        raw.set_boolean('show-running-count', false);
        raw.set_boolean('show-stopped-instances', false);
        raw.set_strv('terminal-command', ['ptyxis', '--']);
        assert.equal(settings.refreshIntervalSeconds, 30);
        assert.equal(settings.showRunningCount, false);
        assert.equal(settings.showStoppedInstances, false);
        assert.deepEqual(settings.terminalCommand, ['ptyxis', '--']);
    }));

test('settings: subscribe reports the key that changed', () =>
    withSettings((settings, raw) => {
        const keys: string[] = [];
        settings.subscribe(key => keys.push(key));
        raw.set_uint('refresh-interval', 5);
        raw.set_boolean('show-running-count', false);
        raw.set_strv('terminal-command', ['kgx', '--']);
        assert.deepEqual(keys, ['refresh-interval', 'show-running-count', 'terminal-command']);
    }));

test('settings: the unsubscribe function stops that callback only', () =>
    withSettings((settings, raw) => {
        const first: string[] = [];
        const second: string[] = [];
        const off = settings.subscribe(key => first.push(key));
        settings.subscribe(key => second.push(key));
        off();
        raw.set_uint('refresh-interval', 7);
        assert.deepEqual(first, []);
        assert.deepEqual(second, ['refresh-interval']);
    }));

test('settings: unsubscribing twice is safe and raises no GLib warning', () =>
    withSettings(async settings => {
        const warnings = await collectingWarnings(() => {
            const off = settings.subscribe(() => undefined);
            off();
            off();
            return Promise.resolve();
        });
        assert.deepEqual(warnings, []);
    }));

test('settings: dispose disconnects every handler', () =>
    withSettings((settings, raw) => {
        const keys: string[] = [];
        settings.subscribe(key => keys.push(key));
        settings.subscribe(key => keys.push(key));
        settings.dispose();
        raw.set_uint('refresh-interval', 9);
        assert.deepEqual(keys, []);
    }));

test('settings: dispose twice is safe', () =>
    withSettings(settings => {
        settings.dispose();
        settings.dispose();
    }));

test('settings: subscribing after dispose connects nothing and its unsubscribe is safe', () =>
    withSettings(async (settings, raw) => {
        settings.dispose();
        const keys: string[] = [];
        const warnings = await collectingWarnings(() => {
            const off = settings.subscribe(key => keys.push(key));
            raw.set_uint('refresh-interval', 11);
            off();
            off();
            return Promise.resolve();
        });
        assert.deepEqual(keys, []);
        assert.deepEqual(warnings, []);
    }));
