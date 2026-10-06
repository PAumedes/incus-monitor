// SPDX-License-Identifier: GPL-2.0-or-later
import St from 'gi://St';

/** Only called from an explicit click: the extension never reads or writes the clipboard on its own. */
export function copyToClipboard(text: string): void {
    St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
}
