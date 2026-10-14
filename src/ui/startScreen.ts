// The screen shown when no document is open: quick actions to start one, plus
// tiles for the auto-saved recent files so work can be resumed right away.
// Also builds the recent tiles used by the Open File dialog.

import { listRecent, RecentEntry } from '../core/recentFiles';
import { h } from '../shared/dom';

function formatSavedAt(time: number): string {
    const delta = Date.now() - time;
    const minute = 60_000;
    const hour = 60 * minute;
    const day = 24 * hour;
    if (delta < minute) {
        return 'just now';
    }
    if (delta < hour) {
        return `${Math.floor(delta / minute)} min ago`;
    }
    if (delta < day) {
        return `${Math.floor(delta / hour)} h ago`;
    }
    return new Date(time).toLocaleString();
}

function formatSize(bytes: number): string {
    if (bytes < 1024) {
        return `${Math.max(0, bytes)} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 1024)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// A clickable recent-file tile: thumbnail, name and details. Shared by the
// start screen and the Open File dialog.
export function createRecentTile(entry: RecentEntry, onOpen: (entry: RecentEntry) => void): HTMLElement {
    const thumbnail = document.createElement('img');
    thumbnail.className = 'recent-tile-thumb';
    thumbnail.alt = '';
    if (entry.thumbnail) {
        thumbnail.src = entry.thumbnail;
    } else {
        thumbnail.classList.add('empty');
    }
    const frames = entry.frameCount > 1 ? `, ${entry.frameCount} frames` : '';
    const saved = new Date(entry.savedAt).toLocaleString();
    return h('button', {
        class: 'recent-tile',
        title: `Open ${entry.name} (saved ${saved})`,
        onclick: () => onOpen(entry),
    }, [
        thumbnail,
        h('span', { class: 'recent-tile-name', text: entry.name }),
        h('span', {
            class: 'recent-tile-meta',
            text: `${entry.width}×${entry.height}${frames}, ${formatSize(entry.size)}`,
        }),
        h('span', { class: 'recent-tile-meta', text: formatSavedAt(entry.savedAt) }),
    ]);
}

export interface StartScreenHooks {
    onNew(): void;
    onOpen(): void;
    onRecent(entry: RecentEntry): void;
}

export interface StartScreen {
    root: HTMLElement;
    // Re-reads the recent files. Cheap to call often: the entry list is cached
    // and the DOM is only rebuilt when it actually changed.
    refresh(): void;
}

export function createStartScreen(hooks: StartScreenHooks): StartScreen {
    const list = h('div', { class: 'recent-tile-list' });
    const recentSection = h('div', { class: 'recent-tiles hidden' }, [
        h('div', { class: 'recent-tiles-title', text: 'Recent files' }),
        list,
    ]);
    const newButton = h('button', { class: 'btn', text: 'New File', onclick: () => hooks.onNew() });
    const openButton = h('button', { class: 'btn', text: 'Open File', onclick: () => hooks.onOpen() });
    const root = h('div', { class: 'start-screen' }, [
        h('div', { class: 'start-title', text: 'Open, paste, drop or create a file to begin' }),
        h('div', { class: 'start-actions' }, [newButton, openButton]),
        recentSection,
    ]);

    let lastKey = '';
    const refresh = (): void => {
        void (async () => {
            const entries = await listRecent();
            const key = entries.map((entry) => `${entry.id}:${entry.savedAt}`).join('|');
            if (key === lastKey) {
                return;
            }
            lastKey = key;
            list.replaceChildren();
            recentSection.classList.toggle('hidden', entries.length === 0);
            for (const entry of entries) {
                list.append(createRecentTile(entry, (chosen) => hooks.onRecent(chosen)));
            }
        })();
    };

    return { root, refresh };
}
