import { AppContext } from '../context';
import { button, createDockPanel, DockPanel, h } from '../shared/dom';
import { isGroup } from '../core/layers';
import { createLayerList } from './layerList';

export function openLayersPanel(ctx: AppContext, onClose?: () => void): DockPanel {
    const { store } = ctx;
    let unlisten: (() => void) | null = null;
    const panel = createDockPanel(ctx.dock, 'Layers', () => {
        unlisten?.();
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
                button('Rename Layer', () => list.renameActive()),
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

    return panel;
}
