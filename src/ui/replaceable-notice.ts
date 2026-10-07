// SPDX-License-Identifier: GPL-2.0-or-later
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

export interface NoticeAction {
    readonly label: string;
    readonly run: () => void;
}

/**
 * The tray source both notices share, so the shell files them under "Incus Monitor" with the
 * panel's icon instead of under its "System" source. The shell destroys a source when its last
 * notification goes, so the source is created on demand and forgotten on its `destroy` signal,
 * as the shell does for its own system source.
 */
export class NoticeSource {
    #source: MessageTray.Source | undefined;

    get(): MessageTray.Source {
        if (this.#source !== undefined) return this.#source;
        // A product name, so it is not translated.
        const source = new MessageTray.Source({
            title: 'Incus Monitor',
            iconName: 'package-x-generic-symbolic',
        });
        source.connect('destroy', () => {
            if (this.#source === source) this.#source = undefined;
        });
        Main.messageTray.add(source);
        this.#source = source;
        return source;
    }

    dispose(): void {
        // The destroy handler clears the reference.
        this.#source?.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
    }
}

/**
 * One notification at a time with at most one action button; a newer one replaces the older.
 * It is used for failed actions, unexpected stops and terminal launch failures. It does not use
 * `notifyError`, which also writes the daemon's text to the journal. With a button the
 * notification is not transient, so it stays in the message tray and the button remains reachable
 * after the banner hides.
 */
export class ReplaceableNotice {
    readonly #sources: NoticeSource;
    #pending: MessageTray.Notification | undefined;
    #pendingKey: string | null = null;

    constructor(sources: NoticeSource) {
        this.#sources = sources;
    }

    /** Shows a notification about the instance `key`; `action` adds a single button. */
    show(key: string, title: string, body: string, action?: NoticeAction): void {
        // One notification at a time: a newer one replaces the older.
        this.#clear();
        const source = this.#sources.get();
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
     * Drops the pending notification when a later action on the same instance succeeded. A success
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
