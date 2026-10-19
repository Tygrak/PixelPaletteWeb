import { AppContext } from '../context';
import { button, createDockPanel, DockPanel, h } from '../shared/dom';
import { isGroup } from '../core/layers';
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
        'Dissolve the selected groups, moving their children up one level',
    );
    const mergeSelectedButton = button(
        'Merge Selected',
        () => store.mergeSelectedLayers(),
        'Merge the selected layers/groups into one layer (Ctrl+E)',
    );

    const syncButtons = (): void => {
        const selected = store.topLevelSelectedNodes();
        groupButton.disabled = selected.length < 2;
        mergeSelectedButton.disabled = selected.length < 2 && !(selected.length === 1 && isGroup(selected[0]));
        ungroupButton.disabled = !store.hasSelectedGroup();
    };

    panel.body.append(
        h('div', { class: 'tab-content' }, [
            h('div', { class: 'fill' }, [list.root]),
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
