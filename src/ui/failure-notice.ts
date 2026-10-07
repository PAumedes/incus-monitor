// SPDX-License-Identifier: GPL-2.0-or-later
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

export interface NoticeAction {
    readonly label: string;
    readonly run: () => void;
}

/**
 * A failure notification with at most one action button. It uses the shell's system source, as
 * `Main.notify` does, so the extension owns no source: it only has to destroy the notification
 * it last showed. It does not use `notifyError`, which also writes the daemon's text to the
 * journal. With a button the notification is not transient, so it stays in the message tray and
 * the button remains reachable after the banner hides.
 */
export class FailureNotice {
    #pending: MessageTray.Notification | undefined;
    #pendingKey: string | null = null;

    /** Shows the failure of the instance `key`; `action` adds a single button. */
    show(key: string, title: string, body: string, action?: NoticeAction): void {
        // One failure at a time: a newer one replaces the older.
        this.#clear();
        const source = MessageTray.getSystemSource();
        const notification = new MessageTray.Notification({
            source,
            title,
            body,
            isTransient: action === undefined,
        });
        if (action !== undefined) notification.addAction(action.label, action.run);
        notification.connect('destroy', () => {
            if (this.#pending !== notification) return;
            this.#pending = undefined;
            this.#pendingKey = null;
        });
        this.#pending = notification;
        this.#pendingKey = key;
        source.addNotification(notification);
    }

    /**
     * Drops the pending failure when a later action on the same instance succeeded. A success
     * cannot clear a newer failure of that instance: a row with an action in flight is inert and
     * offers no second action, so the failure shown is always the older one.
     */
    clear(key: string): void {
        if (this.#pendingKey === key) this.#clear();
    }

    dispose(): void {
        this.#clear();
    }

    #clear(): void {
        const pending = this.#pending;
        this.#pending = undefined;
        this.#pendingKey = null;
        pending?.destroy();
    }
}
