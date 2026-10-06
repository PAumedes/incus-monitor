---
name: drive-extension
description: How to observe and drive the installed Incus Monitor inside a running GNOME Shell without touching the maintainer's desktop - extension state and errors over D-Bus, logs, GSettings, opening the menu and expanding rows, injecting clicks, PNG screenshots, real Incus data, and the safety rules. Use when you need to see or exercise the extension live, beyond unit tests and make smoke.
---

# Drive the extension

Everything below was run on Ubuntu 26.04, GNOME Shell 50.1, Wayland, in a throwaway headless Shell.
GNOME 46 was not run here; those points are marked. For which verification tier to pick, see
`ui-verification`; this skill is the how.

## Safety first

Your own shell talks to the maintainer's real session (`DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus`,
no `DCONF_PROFILE`). In that session only read: `journalctl`, `gnome-extensions info|list`,
`gdbus call ... GetExtensionInfo`, `gsettings get`. Never `gnome-extensions enable|disable|reset`,
`gsettings set`, `EnableExtension`, or a Shell restart there unless the maintainer asked.

Do the rest in a headless Shell on its own bus and dconf database (the `scripts/smoke-shell.sh`
technique): `dbus-run-session` gives a fresh bus, a private `DCONF_PROFILE` file holding
`user-db:<name>` gives fresh settings. A command is aimed at the headless session only when both are
exported in that command; check with `echo $DBUS_SESSION_BUS_ADDRESS` (the private bus is
`unix:path=/tmp/dbus-...`). A persistent session needs a script, because `dbus-run-session` ends with
its child: write the bus address to a file, background the Shell, `wait`.

Nested (`make nested`, needs `mutter-dev-bin` on 49+, absent here) and the VM (`make vm`, the only
GNOME 46 route; not run here) are for looking by eye; headless is for everything below.

Headless start (after `make install`; the profile name is yours):

```sh
printf 'user-db:imon_drive\n' > $S/profile   # S: scratchpad directory
export DCONF_PROFILE=$S/profile
dbus-run-session -- bash -c 'echo $DBUS_SESSION_BUS_ADDRESS > $S/addr
  gsettings set org.gnome.shell disable-user-extensions false
  gsettings set org.gnome.shell enabled-extensions "[\"incus-monitor@patricioaumedes\"]"
  gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x800 --mode=ubuntu >$S/shell.log 2>&1 &
  echo $! > $S/shellpid; wait' &
```

Use `--mode=user` when the Yaru theme is missing (see the script). Then in each command:
`export DBUS_SESSION_BUS_ADDRESS=$(cat $S/addr) DCONF_PROFILE=$S/profile`. The Shell takes
`wayland-1`; the `wayland-0.lock` warning in its log is the real compositor and harmless.

## What to run

| Goal                          | Command (headless env exported)                                                                                                                                                          | Verified                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| State, error text, `hasPrefs` | `gnome-extensions info $U` or `gdbus call --session --dest org.gnome.Shell.Extensions --object-path /org/gnome/Shell/Extensions --method org.gnome.Shell.Extensions.GetExtensionInfo $U` | 50                        |
| Load errors                   | same call, method `GetExtensionErrors` (`@as []` is clean)                                                                                                                               | 50                        |
| Toggle                        | `gnome-extensions disable\|enable $U`, or D-Bus `DisableExtension`, `EnableExtension`                                                                                                    | 50                        |
| Open preferences              | `gnome-extensions prefs $U`, or D-Bus `OpenExtensionPrefs $U "" "{}"`, `LaunchExtensionPrefs`                                                                                            | 50                        |
| Reload code                   | Restart the headless Shell. `ReloadExtension` is in the introspection but answers "not implemented"                                                                                      | 50                        |
| Log                           | `grep -iE 'incus' $S/shell.log` (real session: `journalctl --user -b -o cat /usr/bin/gnome-shell -f`)                                                                                    | 50 / journalctl read only |
| Settings                      | `gsettings --schemadir <ext>/schemas get\|set org.gnome.shell.extensions.incus-monitor <key> <v>`                                                                                        | 50                        |
| Open menu, expand, shot       | scratch helper below                                                                                                                                                                     | 50                        |
| Real click                    | RemoteDesktop recipe below                                                                                                                                                               | 50                        |

`$U` is `incus-monitor@patricioaumedes`. `state` 1 is ACTIVE (named ENABLED before 47), the CLI prints
`ACTIVE` or `INACTIVE`. The CLI `disable` empties `enabled-extensions` in the private profile (it was `[]` afterwards) and
`reset` clears the uuid from both lists, so the extension is off. On GNOME 46 the
Extensions API is served by bus `org.gnome.Shell`, path `/org/gnome/Shell`, not
`org.gnome.Shell.Extensions` (taken from `smoke-shell.sh`, not run on 46 here). `gnome-extensions`
needs no extra flags; it follows the exported bus. An extension dropped into
`~/.local/share/gnome-shell/extensions` after the Shell started is not seen (`does not exist`):
install first, then start.

## Logs

The extension logs with `console.warn`, once per failure episode (`core/monitor.ts`), sanitised.
Seen in the headless log when `INCUS_SOCKET` pointed at a socket that answered with a wrong body:

```text
(gnome-shell:81438): GNOME Shell-WARNING **: 14:03:17.772: Incus decode error: metadata.environment: expected an object
```

`INCUS_SOCKET` is read once at `enable()` from the Shell's environment, so set it before starting the
Shell (`INCUS_SOCKET=$S/fake.sock ./start.sh`). A twenty-line Python `socket` server answering
HTTP/1.1 with a JSON body was enough for the fake; `tests/gjs/fake-server.ts` is the maintained one.

## Settings

Keys: `refresh-interval` (u, 2 to 60), `show-running-count`, `show-stopped-instances` (b),
`terminal-command` (as). The schema is not installed system-wide, so plain `gsettings` says
`No such schema`: pass `--schemadir ~/.local/share/gnome-shell/extensions/$U/schemas`. With the
private profile, `dconf dump /org/gnome/shell/extensions/incus-monitor/` shows what you wrote, and the
real value stays untouched. The profile file persists between runs: `rm ~/.config/dconf/<name>` when
done. Verified live: flipping `show-stopped-instances` added and removed the stopped row within a
second with no restart. `refresh-interval` and `terminal-command` are read live by the monitor and
the launcher (per `extension.ts`), not exercised here.

## Scratch helper: menu, rows, screenshots

`Shell.Eval` is disabled (`gdbus ... org.gnome.Shell.Eval "1+1"` returns `(false, '')`) and the
`org.gnome.Shell.Screenshot` D-Bus call answers `AccessDenied: Screenshot is not allowed`. Use a
throwaway extension kept outside the repo (copy it to
`~/.local/share/gnome-shell/extensions/imon-drive-helper@scratch.local` with a `metadata.json` listing
shell versions 46 to 50, enable it in the headless profile, delete the directory afterwards) that
exports a D-Bus object. The core of it, verified:

```js
const button = () => Main.panel.statusArea['incus-monitor@patricioaumedes'];
// enable():  this._o = Gio.DBusExportedObject.wrapJSObject(XML, this);
//            this._o.export(Gio.DBus.session, '/org/imon/Drive');
//            this._n = Gio.bus_own_name_on_connection(Gio.DBus.session, 'org.imon.Drive', 0, null, null);
// disable(): this._o.unexport(); Gio.bus_unown_name(this._n);
SetMenu(open) { open ? button().menu.open(false) : button().menu.close(false); return String(button().menu.isOpen); }
// Rows are PopupSubMenuMenuItem: walk menu.actor, keep actors whose _delegate has .menu and .label
Expand(name) { /* item.menu.open(false) for the row whose label.text === name */ }
Shot(path) { const out = Gio.File.new_for_path(path).replace(null, false, 0, null);
  new Shell.Screenshot().screenshot(false, out, (s, res) => { s.screenshot_finish(res); out.close(null); }); }
```

Call it with `gdbus call --session --dest org.imon.Drive --object-path /org/imon/Drive --method
org.imon.Drive.SetMenu true`. `Shot` returns before the file is written: sleep two seconds, then open
the PNG with the Read tool (1280x800, the whole screen including the open menu and expanded rows).
Rows are an accordion: expanding one collapses the previous. A second `Shot` call with
`gnome-extensions prefs $U` running captured the preferences window too. `Shell.Screenshot.screenshot`
and `Main.panel.statusArea` are stable on 50; the 46 signatures were not checked here, so confirm on a
46 Shell before relying on it there. Add a `Where` method returning the button's
`get_transformed_position()` and size plus `global.get_pointer()` for the next recipe.

## Real clicks through RemoteDesktop

`org.gnome.Mutter.RemoteDesktop` is on the private bus. A session needs no ScreenCast for relative
motion and buttons: `CreateSession`, `Start`, `NotifyPointerMotionRelative(dd)`,
`NotifyPointerButton(ib)` with button `0x110` pressed then released, all from one client (the
session dies with it; do not call `Stop`, it failed with "Object does not exist"). Pitfalls seen:

- The pointer starts at 0,0; move relatively by target minus `Where.pointer`.
- While a session is live a Screen Sharing indicator joins the panel and shifts the Incus button, so
  wait 0.5 s after `Start` and read `Where` then. Clicking the stale coordinates hit the indicator.
- Absolute motion needs a ScreenCast stream; it moved the pointer but the session then closed under
  button events. Not recommended.

Two clicks on the button toggled `menu.isOpen` true then false. Keyboard injection
(`NotifyKeyboardKeysym`) was not tried.

## Real data

`make demo` creates `imon-demo-*` (running, busy, stopped, frozen, a VM); the agent may not
`incus delete|stop|restart` (`.claude/settings.json`), the maintainer runs `make demo-clean`.
The headless Shell reads the same `/var/lib/incus/unix.socket.user`, so rows show real instances.
Read-only probe: `curl -s --unix-socket /var/lib/incus/unix.socket.user 'http://incus/1.0/instances?all-projects=true&recursion=2'`
returns `status_code` 200 and `metadata[]` with `name`, `project`, `status`, `type`, `state.cpu`,
`state.memory`, `state.network`. Never change the state of the maintainer's instances.

## Pitfalls

- `kill` can be refused in restricted containers and a slow Shell may linger: SIGTERM, poll up to 5 s,
  then SIGKILL (`stop_shell` in `scripts/smoke-shell.sh`). After stopping, check
  `ps -eo pid,ppid,args | grep -E 'headless|dbus-run-session|ding.js'`. A `ding.js` whose parent is the
  real Shell is the maintainer's: leave it.
- `pkill -f <pattern>` can match your own command line; use the saved pid.
- The `org.gnome.Shell.Extensions` prefs host (`gjs -m .../org.gnome.Shell.Extensions`) outlives the
  call: kill it by pid when finished.
- A running Shell caches the ES modules: after `make install` restart the headless Shell, a
  disable/enable cycle is not enough (standard GJS behaviour, not re-tested here).
- Noise in the headless log (Online Accounts, geolocation portal, NM typing) is not the extension.
- Clean up when done: stop the Shell, delete the scratch extension directory, the dconf profile and
  any fake server.
