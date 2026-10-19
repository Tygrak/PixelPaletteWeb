// Compact node list shown at the bottom of the sidebar while the full docked
// Layers panel is closed. It lists the layer tree (groups with indented
// children), lets you select, reorder and nest nodes, and has add / delete
// buttons.

import { h } from '../shared/dom';
import { Store } from '../core/store';
import { createLayerList } from './layerList';

export interface MiniLayers {
    root: HTMLElement;
    sync(): void;
    // Starts the inline rename of the active layer (Ctrl+R).
    renameActive(): void;
}

const WRAP = (inner: string): string =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const PLUS_ICON = WRAP('<path d="M12 5v14M5 12h14"/>');
const TRASH_ICON = WRAP(
    '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
);

export function createMiniLayers(store: Store, isFullPanelOpen: () => boolean): MiniLayers {
    const list = createLayerList({
        store,
        listClass: 'mini-layer-list',
        rowClass: 'mini-layer-item',
        headerClass: 'mini-layer-group',
        nameClass: 'mini-layer-name',
        renameClass: 'layer-rename',
        rename: true,
        indentBase: 4,
        indentStep: 12,
    });

    const addButton = h('button', {
        class: 'mini-layers-btn',
        title: 'Add layer (Ctrl+N)',
        onclick: () => store.addLayer(),
    });
    addButton.innerHTML = PLUS_ICON;

    const deleteButton = h('button', {
        class: 'mini-layers-btn',
        title: 'Delete the selected layers/groups',
        onclick: () => store.deleteLayer(),
    });
    deleteButton.innerHTML = TRASH_ICON;

    const root = h('div', { class: 'mini-layers' }, [
        h('div', { class: 'mini-layers-head' }, [
            h('span', { class: 'mini-layers-title', text: 'Layers' }),
            addButton,
            deleteButton,
        ]),
        list.root,
    ]);

    function sync(): void {
        const show = store.layers.length > 0 && !isFullPanelOpen();
        root.classList.toggle('hidden', !show);
        if (!show) {
            return;
        }
        list.sync();
        addButton.disabled = false;
        deleteButton.disabled = store.layers.length < 2;
    }

    return { root, sync, renameActive: () => list.renameActive() };
}
