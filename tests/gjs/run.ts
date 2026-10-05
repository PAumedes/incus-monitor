// SPDX-License-Identifier: GPL-2.0-or-later
// Entry point: gjs -m build/gjs/tests/gjs/run.js
// Imports every *.test.js next to this file, then runs them inside a GLib main loop.
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import System from 'system';

import { runRegistered } from './harness.js';

const here = Gio.File.new_for_uri(import.meta.url).get_parent();
if (!here) throw new Error('cannot resolve test directory');

const enumerator = here.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
const modules: string[] = [];
for (let info = enumerator.next_file(null); info; info = enumerator.next_file(null)) {
    const name = info.get_name();
    if (name.endsWith('.test.js')) modules.push(name);
}

const loop = new GLib.MainLoop(null, false);
let exitCode = 1;

(async () => {
    for (const name of modules.sort()) await import(`./${name}`);
    exitCode = (await runRegistered()) === 0 ? 0 : 1;
})()
    .catch((error: unknown) => {
        printerr(String(error));
    })
    .finally(() => {
        loop.quit();
    });

loop.run();
System.exit(exitCode);
