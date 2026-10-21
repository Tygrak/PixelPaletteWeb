// Right-click menu for layer rows, shared by the Layers panel and the mini
// list: an opacity slider for the clicked node plus the panel's selection
// operations (rename, duplicate, merge, group, ungroup, delete).

import { store } from '../appStore';
import { findParent, isLayer, LayerNode } from '../core/layers';
import { h } from '../shared/dom';

export interface LayerMenuActions {
    // Starts the inline rename for the given node in the list that opened the
    // menu.
    rename(id: number): void;
}

// The menu currently open (only one at a time).
let closeCurrent: (() => void) | null = null;

// True when a layer can merge down into a layer directly below it in the same
// group.
function canMergeDown(node: LayerNode): boolean {
    if (!isLayer(node)) {
        return false;
    }
    const parent = findParent(store.nodes, node.id);
    const list = parent ? parent.children : store.nodes;
    const index = list.indexOf(node);
    return index > 0 && isLayer(list[index - 1]);
}

export function openLayerContextMenu(
    node: LayerNode,
    actions: LayerMenuActions,
    clientX: number,
    clientY: number,
): void {
    closeCurrent?.();

    // The clicked row is selected before this runs, so the operations act on
    // whatever is highlighted (a single node or a multi-selection).
    const selected = store.topLevelSelectedNodes();
    const targets = selected.length > 0 ? selected : [node];
    const targetIds = targets.map((entry) => entry.id);

    const menu = h('div', { class: 'layer-context-menu' });

    // --- Opacity for the clicked node / selection ---
    const opacitySlider = h('input', { type: 'range', min: '0', max: '100', step: '1' });
    opacitySlider.value = String(Math.round(node.opacity * 100));
    opacitySlider.title = 'Opacity of the selected layers/groups.';
    const opacityLabel = h('span', { class: 'row-value', text: `${Math.round(node.opacity * 100)}%` });
    let opacityEditing = false;
    opacitySlider.addEventListener('input', () => {
        const value = Number(opacitySlider.value) / 100;
        store.setNodeOpacity(targetIds, value, !opacityEditing);
        opacityEditing = true;
        opacityLabel.textContent = `${Math.round(value * 100)}%`;
    });
    opacitySlider.addEventListener('change', () => {
        opacityEditing = false;
    });
    menu.append(
        h('div', { class: 'layer-context-opacity' }, [
            h('span', { class: 'row-label', text: 'Opacity' }),
            opacitySlider,
            opacityLabel,
        ]),
    );
    menu.append(h('div', { class: 'layer-context-separator' }));

    // --- Operations (same set as the Layers panel buttons) ---
    const items: { label: string; action: () => void; enabled?: boolean; title?: string }[] = [
        { label: 'Rename', action: () => actions.rename(node.id), title: 'Rename this layer/group (Ctrl+R)' },
        {
            label: 'Duplicate',
            action: () => store.duplicateLayer(),
            title: 'Duplicate the selected layers/groups (Ctrl+D)',
        },
        {
            label: 'Merge Down',
            action: () => {
                store.setActiveLayer(node.id);
                store.mergeLayers();
            },
            enabled: canMergeDown(node),
            title: 'Merge this layer into the layer below it (Ctrl+E)',
        },
        {
            label: 'Merge Selected',
            action: () => store.mergeSelectedLayers(),
            enabled: targets.length >= 2 || (targets.length === 1 && targets[0].kind === 'group'),
            title: 'Merge the selected layers/groups into one layer (Ctrl+E)',
        },
        {
            label: 'Group',
            action: () => store.groupSelectedLayers(),
            enabled: targets.length >= 2,
            title: 'Wrap the selected layers/groups in a new group (Ctrl+G)',
        },
        {
            label: 'Ungroup',
            action: () => store.ungroupSelectedLayers(),
            enabled: store.hasSelectedGroup(),
            title: 'Dissolve the selected groups, moving their children up one level (Ctrl+G with only a group selected)',
        },
        {
            label: 'Delete',
            action: () => store.deleteLayer(),
            enabled: store.layers.length > 1,
            title: 'Delete the selected layers/groups (Delete)',
        },
    ];
    for (const item of items) {
        const button = h('button', { class: 'layer-context-item', text: item.label });
        if (item.title) {
            button.title = item.title;
        }
        button.disabled = item.enabled === false;
        button.addEventListener('click', () => {
            close();
            item.action();
        });
        menu.append(button);
    }

    // --- Open / close ---
    const onPointerDown = (event: PointerEvent): void => {
        if (!menu.contains(event.target as Node)) {
            close();
        }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
        }
    };
    function close(): void {
        menu.remove();
        document.removeEventListener('pointerdown', onPointerDown, true);
        document.removeEventListener('keydown', onKeyDown, true);
        window.removeEventListener('blur', close);
        window.removeEventListener('resize', close);
        if (closeCurrent === close) {
            closeCurrent = null;
        }
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', close);
    window.addEventListener('resize', close);
    closeCurrent = close;

    document.body.append(menu);
    // Keep the menu inside the viewport.
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(clientX, window.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(clientY, window.innerHeight - rect.height - 4))}px`;
}
