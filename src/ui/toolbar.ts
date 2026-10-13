import { store } from '../appStore';
import { h } from '../shared/dom';
import { isFloating } from '../editor/floatingSelection';

// Top toolbar: file actions, undo/redo/restore and the status readouts. The
// actions themselves are supplied by the app wiring.

export interface ToolbarHooks {
    onNew(): void;
    onOpen(): void;
    onSave(): void;
    onUndo(): void;
    onRedo(): void;
    onRestore(): void;
}

export interface Toolbar {
    element: HTMLElement;
    refresh(): void;
}

export function createToolbar(hooks: ToolbarHooks): Toolbar {
    const newButton = h('button', {
        class: 'btn toolbar-btn',
        text: 'New File',
        onclick: () => hooks.onNew(),
    });
    const openButton = h('button', {
        class: 'btn toolbar-btn',
        text: 'Open File',
        onclick: () => hooks.onOpen(),
    });
    const saveButton = h('button', {
        class: 'btn toolbar-btn',
        text: 'Save File',
        title: 'Save File (Ctrl+S)',
        onclick: () => hooks.onSave(),
    });
    const undoButton = h('button', {
        class: 'btn toolbar-btn',
        text: 'Undo',
        title: 'Undo (Ctrl+Z)',
        onclick: () => hooks.onUndo(),
    });
    const redoButton = h('button', {
        class: 'btn toolbar-btn',
        text: 'Redo',
        title: 'Redo (Ctrl+Y)',
        onclick: () => hooks.onRedo(),
    });
    const restoreButton = h('button', {
        class: 'btn toolbar-btn',
        text: 'Restore',
        onclick: () => hooks.onRestore(),
    });

    const imageSizeText = h('span', { class: 'image-size' });
    const statusText = h('span', { class: 'status' });

    const element = h('div', { class: 'toolbar' }, [
        newButton,
        openButton,
        saveButton,
        undoButton,
        redoButton,
        restoreButton,
        h('div', { class: 'spacer' }),
        imageSizeText,
        statusText,
    ]);

    function refresh(): void {
        const working = store.working;
        undoButton.disabled = working || (!store.canUndo() && !isFloating());
        redoButton.disabled = working || !store.canRedo() || isFloating();
        restoreButton.disabled = working || store.current === null;
        openButton.disabled = working;
        newButton.disabled = working;
        saveButton.disabled = working || store.current === null;
        imageSizeText.textContent = store.current ? `${store.current.width}x${store.current.height}` : '';
        statusText.textContent = store.status;
    }

    return { element, refresh };
}
