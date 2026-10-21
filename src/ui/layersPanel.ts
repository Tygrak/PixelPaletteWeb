import { AppContext } from '../context';
import { button, createDockPanel, DockPanel, h } from '../shared/dom';
import { isGroup, LayerNode } from '../core/layers';
import { createLayerList } from './layerList';

// The docked Layers panel is a singleton (ui/panels.ts keeps one open at a
// time), so Ctrl+R renames through this when the panel is open and through the
// mini list otherwise.
let renameActiveInPanel: (() => void) | null = null;

// Starts the inline rename in the docked Layers panel; false when it is closed.
export function renameActiveLayerInPanel(): boolean {
    if (!renameActiveInPanel) {
        return false;
    }
    renameActiveInPanel();
    return true;
}

export function openLayersPanel(ctx: AppContext, onClose?: () => void): DockPanel {
    const { store } = ctx;
    let unlisten: (() => void) | null = null;
    const panel = createDockPanel(ctx.dock, 'Layers', () => {
        unlisten?.();
        renameActiveInPanel = null;
        onClose?.();
    });

    const list = createLayerList({
        store,
        listClass: 'layer-list',
        rowClass: 'layer-item',
        headerClass: 'layer-group-item',
        nameClass: 'layer-name',
        renameClass: 'layer-rename',
        rename: true,
        indentBase: 8,
        indentStep: 14,
    });

    const groupButton = button(
        'Group Layers',
        () => store.groupSelectedLayers(),
        'Group the selected layers/groups (Ctrl+G; with only a group selected, Ctrl+G ungroups instead)',
    );
    const ungroupButton = button(
        'Ungroup',
        () => store.ungroupSelectedLayers(),
        'Dissolve the selected groups, moving their children up one level (Ctrl+G with only a group selected)',
    );
    const mergeSelectedButton = button(
        'Merge Selected',
        () => store.mergeSelectedLayers(),
        'Merge the selected layers/groups into one layer (Ctrl+E)',
    );

    // --- Opacity slider (layers and groups) ---
    const opacitySlider = h('input', { type: 'range', min: '0', max: '100', step: '1', value: '100' });
    opacitySlider.title = 'Opacity of the selected layers/groups.';
    const opacityValue = h('span', { class: 'row-value', text: '100%' });
    const opacityRow = h('div', { class: 'row' }, [
        h('span', { class: 'row-label', text: 'Opacity' }),
        h('div', { class: 'row-controls layer-opacity' }, [opacitySlider, opacityValue]),
    ]);

    // The slider edits the selected nodes, or the active layer when nothing is
    // selected. A drag keeps a single undo entry (pushed on its first input).
    const opacityTargets = (): LayerNode[] => {
        const selected = store.topLevelSelectedNodes();
        if (selected.length > 0) {
            return selected;
        }
        const layer = store.activeLayer;
        return layer ? [layer] : [];
    };
    let opacityEditing = false;
    const syncOpacity = (): void => {
        const targets = opacityTargets();
        const value = targets.length > 0 ? targets[0].opacity : 1;
        if (document.activeElement !== opacitySlider) {
            opacitySlider.value = String(Math.round(value * 100));
        }
        opacityValue.textContent = `${Math.round(value * 100)}%`;
        opacitySlider.disabled = targets.length === 0;
    };
    opacitySlider.addEventListener('input', () => {
        const targets = opacityTargets();
        if (targets.length === 0) {
            return;
        }
        const value = Number(opacitySlider.value) / 100;
        store.setNodeOpacity(targets.map((node) => node.id), value, !opacityEditing);
        opacityEditing = true;
        opacityValue.textContent = `${Math.round(value * 100)}%`;
    });
    opacitySlider.addEventListener('change', () => {
        opacityEditing = false;
    });

    const syncButtons = (): void => {
        const selected = store.topLevelSelectedNodes();
        groupButton.disabled = selected.length < 2;
        mergeSelectedButton.disabled = selected.length < 2 && !(selected.length === 1 && isGroup(selected[0]));
        ungroupButton.disabled = !store.hasSelectedGroup();
        syncOpacity();
    };

    panel.body.append(
        h('div', { class: 'tab-content' }, [
            h('div', { class: 'fill' }, [list.root]),
            opacityRow,
            h('div', { class: 'button-row' }, [
                button('New Layer', () => store.addLayer(), 'New Layer (Ctrl+N)'),
                button('Duplicate Layer', () => store.duplicateLayer(), 'Duplicate the selected layers/groups (Ctrl+D)'),
                button('Rename Layer', () => list.renameActive(), 'Rename the active layer (Ctrl+R)'),
                button('Merge Down', () => store.mergeLayers(), 'Merge the active layer down (Ctrl+E)'),
                mergeSelectedButton,
                groupButton,
                ungroupButton,
                button('Delete Layer', () => store.deleteLayer()),
            ]),
        ]),
    );

    list.sync();
    syncButtons();
    unlisten = store.onChange(() => {
        list.sync();
        syncButtons();
    });
    // Ctrl+R: rename the active layer here while this panel is open.
    renameActiveInPanel = () => list.renameActive();

    return panel;
}
