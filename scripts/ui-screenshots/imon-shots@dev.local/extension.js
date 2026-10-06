// SPDX-License-Identifier: GPL-2.0-or-later
// Development tool, never packaged: drives the Incus Monitor menu in a throwaway Shell and writes
// one PNG plus a diagnostics line block per scenario. Configured by scripts/ui-screenshots.sh
// through SHOT_DIR, SHOT_PREFIX and SHOT_ROWS (comma-separated row names; empty means the first row).
// Scenarios: rest (row expanded), hover (pointer over the first action), leave and leave-header
// (pointer moved from Open Shell or the header on to an inert detail row) and tab (reached with the
// keyboard, then Tab). With SHOT_RESTART set it also restarts each named row from the keyboard
// (Tab to Restart, Return) and records key focus right after, while pending and once settled: it
// really restarts the instance, so name throwaway rows. It reaches into the extension's menu items, so it breaks with the UI on purpose.
/* global global, log */
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

const TARGET = 'incus-monitor@patricioaumedes';
const SCENARIOS = ['rest', 'hover', 'leave', 'leave-header', 'tab'];

const env = name => GLib.getenv(name) ?? '';
const now = () => GLib.get_monotonic_time();

const sleep = ms =>
    new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });

const center = actor => {
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    return [x + w / 2, y + h / 2];
};

const describe = actor => {
    const [x, y] = actor.get_transformed_position();
    const [w, h] = actor.get_transformed_size();
    const pseudo = actor.get_style_pseudo_class?.() ?? '';
    return `${actor.constructor.name} .${actor.style_class ?? ''} [${pseudo}] x=${Math.round(x)} y=${Math.round(y)} w=${Math.round(w)} h=${Math.round(h)} visible=${actor.visible}`;
};

const descendants = actor => actor.get_children().flatMap(c => [c, ...descendants(c)]);

const menuItems = menu =>
    menu
        ._getMenuItems()
        .flatMap(item => (item._getMenuItems ? [item, ...menuItems(item)] : [item]));

const screenshot = async path => {
    const stream = Gio.File.new_for_path(path).replace(null, false, Gio.FileCreateFlags.NONE, null);
    const shot = new Shell.Screenshot();
    try {
        await new Promise((resolve, reject) => {
            shot.screenshot(false, stream, (_source, result) => {
                try {
                    shot.screenshot_finish(result);
                    resolve();
                } catch (e) {
                    reject(e);
                }
            });
        });
    } finally {
        stream.close(null);
    }
};

export default class ScreenshotsExtension extends Extension {
    enable() {
        this._run().catch(e => {
            log(`imon-shots: ${e}\n${e.stack}`);
            // A failure must end the wait in the script instead of hitting its timeout.
            GLib.file_set_contents(`${env('SHOT_DIR')}/failed`, `${e}`);
        });
    }

    disable() {}

    async _run() {
        const dir = env('SHOT_DIR');
        const prefix = env('SHOT_PREFIX');
        const diagnostics = [];

        let indicator = null;
        for (let i = 0; i < 120 && !indicator; i++) {
            indicator = Main.panel.statusArea[TARGET];
            if (!indicator) await sleep(500);
        }
        if (!indicator) throw new Error(`${TARGET} never appeared in the panel`);

        const seat = Clutter.get_default_backend().get_default_seat();
        const pointer = seat.create_virtual_device(Clutter.InputDeviceType.POINTER_DEVICE);
        const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
        const press = async keyval => {
            keyboard.notify_keyval(now(), keyval, Clutter.KeyState.PRESSED);
            keyboard.notify_keyval(now(), keyval, Clutter.KeyState.RELEASED);
            await sleep(400);
        };
        const focus = () => {
            const actor = global.stage.key_focus;
            return actor ? describe(actor) : 'none';
        };

        // The first poll after enable() has to land before there are rows to look at.
        await sleep(1000);
        indicator.menu.open(false);
        await sleep(4000);

        const rows = menuItems(indicator.menu).filter(
            item => item.constructor.name === 'PopupSubMenuMenuItem',
        );
        diagnostics.push(`rows: ${rows.map(row => row.label.text).join(', ')}`);

        const wanted = env('SHOT_ROWS').split(',').filter(Boolean);
        const names = wanted.length > 0 ? wanted : rows.slice(0, 1).map(row => row.label.text);

        for (const name of names) {
            const row = rows.find(r => r.label.text === name);
            if (!row) throw new Error(`no row named ${name}; rows: ${rows.map(r => r.label.text)}`);

            for (const scenario of SCENARIOS) {
                pointer.notify_absolute_motion(now(), 5, 5);
                indicator.menu.close(false);
                await sleep(500);

                if (scenario === 'tab') {
                    indicator.grab_key_focus();
                    await press(Clutter.KEY_Return);
                    let steps = 0;
                    while (global.stage.key_focus !== row && steps++ < 30) {
                        await press(Clutter.KEY_Down);
                    }
                    diagnostics.push(
                        `${name}/${scenario}: reached row after ${steps} Down presses`,
                    );
                    await press(Clutter.KEY_Return);
                    await sleep(1500);
                    await press(Clutter.KEY_Tab);
                } else {
                    indicator.menu.open(false);
                    await sleep(1500);
                    for (const other of rows) other.menu.close(false);
                    await sleep(300);
                    row.menu.open(false);
                    await sleep(2000);
                    // The first plain item in the expanded row is the Open Shell action.
                    const action =
                        scenario === 'leave-header'
                            ? row
                            : row.menu
                                  ._getMenuItems()
                                  .find(i => i.constructor.name === 'PopupMenuItem');
                    if (scenario !== 'rest' && action) {
                        pointer.notify_absolute_motion(now(), ...center(action));
                        await sleep(600);
                    }
                    if (scenario.startsWith('leave')) {
                        pointer.notify_absolute_motion(
                            now(),
                            ...center(row.menu._getMenuItems()[0]),
                        );
                        await sleep(600);
                    }
                }

                diagnostics.push(
                    `--- ${name}/${scenario}: header [${row.get_style_pseudo_class()}]`,
                );
                diagnostics.push(`key focus: ${focus()}`);
                for (const item of row.menu._getMenuItems()) diagnostics.push(describe(item));

                await screenshot(`${dir}/${prefix}${name}-${scenario}.png`);

                if (scenario.startsWith('leave')) {
                    // Keyboard navigation must still start somewhere sensible after the pointer left.
                    await press(Clutter.KEY_Down);
                    diagnostics.push(`${name}/${scenario}: key focus after Down: ${focus()}`);
                }
            }
        }

        if (env('SHOT_RESTART')) {
            for (const name of names) {
                const row = rows.find(r => r.label.text === name);
                pointer.notify_absolute_motion(now(), 5, 5);
                indicator.menu.close(false);
                await sleep(500);
                indicator.menu.open(false);
                await sleep(1500);
                for (const other of rows) other.menu.close(false);
                await sleep(300);
                row.menu.open(false);
                await sleep(2000);
                // The row rebuilds its buttons when the actions change, so look the button up each time.
                const findRestart = () =>
                    descendants(row.menu.actor).find(
                        a => a instanceof St.Button && a.accessible_name === 'Restart',
                    );
                const restart = findRestart();
                if (!restart) {
                    diagnostics.push(`${name}/restart: no Restart button (is the row running?)`);
                    continue;
                }
                row.grab_key_focus();
                let steps = 0;
                while (global.stage.key_focus !== restart && steps++ < 12)
                    await press(Clutter.KEY_Tab);
                diagnostics.push(`${name}/restart: reached Restart after ${steps} Tab presses`);
                diagnostics.push(`${name}/restart before: ${focus()}`);
                await press(Clutter.KEY_Return);
                diagnostics.push(`${name}/restart +400ms: ${focus()}`);
                await screenshot(`${dir}/${prefix}${name}-restart-pending.png`);
                // Poll until the buttons take focus again, or give up after 40 s.
                for (let t = 1; t <= 40; t++) {
                    await sleep(1000);
                    diagnostics.push(
                        `${name}/restart +${t}s: ${focus()} | restart can_focus=${findRestart()?.can_focus}`,
                    );
                    if (findRestart()?.can_focus && t >= 3) break;
                }
                await sleep(1500);
                diagnostics.push(`${name}/restart settled: ${focus()}`);
                await screenshot(`${dir}/${prefix}${name}-restart-settled.png`);
                await press(Clutter.KEY_Tab);
                diagnostics.push(`${name}/restart after Tab: ${focus()}`);
            }
        }

        GLib.file_set_contents(`${dir}/${prefix}diagnostics.txt`, diagnostics.join('\n'));
        indicator.menu.close(false);
        await sleep(500);
        GLib.file_set_contents(`${dir}/done`, 'ok');
    }
}
