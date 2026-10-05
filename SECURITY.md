# Security

## Reporting a vulnerability

Please **do not** open a public issue. Use GitLab's confidential issue option, or email the
maintainer. You will get an answer within 7 days. Fixes are released as soon as they are
verified, with credit if you want it.

## Supported versions

Only the latest release on extensions.gnome.org receives fixes.

## Threat model

The extension runs inside `gnome-shell`, the user's compositor. A crash or a hang there affects
the whole session, and code running there has the user's full privileges.

| Asset / boundary                               | Threat                                                            | Mitigation                                                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Incus socket (`incus-admin` = root-equivalent) | Unintended actions on instances                                   | Only start/stop/restart/freeze/unfreeze, and only on explicit click. No delete, exec or file APIs.                                                    |
| JSON from the daemon                           | Malformed or hostile data crashing the shell, or injecting markup | Typed decoders reject unknown shapes. Labels are set as plain text, never Pango markup. Size limits in the HTTP parser.                               |
| Subprocess spawn (terminal)                    | Argument injection via instance or project names                  | argv arrays via `Gio.Subprocess`, never a shell. Names validated against Incus naming rules. The terminal command comes from the user's own settings. |
| Main loop                                      | Denial of service via slow or huge responses                      | Async I/O only, timeouts, one in-flight request per stream, body and header size caps.                                                                |
| Clipboard                                      | Leaking data                                                      | Written only on an explicit "Copy address" click; declared in the description.                                                                        |
| Network                                        | Exfiltration                                                      | No network access besides the local unix socket. No telemetry.                                                                                        |

The `terminal-command` setting is executed as given with the user's privileges: it is arbitrary command execution as the user by design, and anything able to write the user's dconf already has that power.

Out of scope: a compromised Incus daemon (it is already root) and other extensions in the same
shell.
