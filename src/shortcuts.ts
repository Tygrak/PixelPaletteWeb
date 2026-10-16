import { store } from './appStore';
import { isGroup } from './core/layers';
import { cancelFloating, commitFloating, copySelectionToClipboard, isFloating } from './editor/floatingSelection';
import { backspaceText, cancelText, commitText, isTextEditing, typeText } from './editor/textTool';
import { ToolId, toolForShortcut } from './core/tools';
import { Timeline } from './ui/timeline';

// Global keyboard shortcuts. Actions that belong to the app wiring (saving,
// tool selection, playback, space-pan state) are injected via hooks.

export interface ShortcutHooks {
    saveDocument(): void;
    selectTool(tool: ToolId): void;
    getTimeline(): Timeline | null;
    clearSymmetryDrag(): void;
    setSpaceHeld(held: boolean): void;
}

export function installShortcuts(hooks: ShortcutHooks): void {
    window.addEventListener('keydown', (event) => {
        const target = event.target as HTMLElement | null;
        const typing =
            target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
        const ctrl = event.ctrlKey || event.metaKey;

        // Ignore auto-repeat for Space so holding it toggles playback once instead of
        // flickering on/off (but let it through when typing in a field).
        if (event.repeat && event.key === ' ' && !typing) {
            event.preventDefault();
            return;
        }

        if (store.playing) {
            // While the animation is playing, only playback controls are available.
            if (event.key === ' ') {
                event.preventDefault();
                hooks.getTimeline()?.togglePlay();
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                hooks.getTimeline()?.stopPlayback();
                return;
            }
            if (ctrl && event.key.toLowerCase() === 's') {
                event.preventDefault();
                hooks.saveDocument();
                return;
            }
            return;
        }

        if (isTextEditing()) {
            if (ctrl) {
                if (event.key.toLowerCase() === 's') {
                    event.preventDefault();
                    hooks.saveDocument();
                }
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                cancelText();
                return;
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                commitText();
                return;
            }
            if (event.key === 'Backspace') {
                event.preventDefault();
                backspaceText();
                return;
            }
            if (event.key.length === 1) {
                event.preventDefault();
                typeText(event.key);
                return;
            }
            return;
        }

        if (ctrl && event.key.toLowerCase() === 's') {
            // Match the toolbar Save button instead of the browser's "Save page".
            event.preventDefault();
            hooks.saveDocument();
            return;
        }
        if (ctrl && event.key.toLowerCase() === 'z') {
            if (typing) {
                return;
            }
            event.preventDefault();
            if (isFloating()) {
                cancelFloating();
            } else if (event.shiftKey) {
                store.redo();
            } else {
                store.undo();
            }
            return;
        }
        if (ctrl && event.key.toLowerCase() === 'y') {
            if (typing) {
                return;
            }
            event.preventDefault();
            if (!isFloating()) {
                store.redo();
            }
            return;
        }
        if (ctrl && event.key.toLowerCase() === 'n') {
            event.preventDefault();
            commitFloating();
            store.addLayer();
            return;
        }
        if (ctrl && event.key.toLowerCase() === 'e') {
            event.preventDefault();
            commitFloating();
            // With several nodes selected (or one group), merge them into one.
            const selected = store.topLevelSelectedNodes();
            if (selected.length >= 2 || (selected.length === 1 && selected[0].kind === 'group')) {
                store.mergeSelectedLayers();
            } else {
                store.mergeLayers();
            }
            return;
        }
        if (ctrl && event.key.toLowerCase() === 'g') {
            event.preventDefault();
            commitFloating();
            // With exactly one group selected Ctrl+G dissolves it (ungroup);
            // otherwise it groups the selection as usual.
            const targets = store.topLevelSelectedNodes();
            if (targets.length === 1 && isGroup(targets[0])) {
                store.ungroupSelectedLayers();
            } else {
                store.groupSelectedLayers();
            }
            return;
        }
        if (ctrl && event.key.toLowerCase() === 'c') {
            if (typing) {
                return;
            }
            if (isFloating() || store.selection) {
                event.preventDefault();
                void copySelectionToClipboard();
            }
            return;
        }
        if (ctrl && event.key.toLowerCase() === 'd') {
            if (typing) {
                return;
            }
            event.preventDefault();
            if (isFloating()) {
                commitFloating();
            }
            store.duplicateLayer();
            return;
        }
        if (typing || ctrl) {
            return;
        }
        // Number keys pick palette colors: 1-9 select the first nine entries, 0 the tenth.
        const paletteIndex = event.key >= '0' && event.key <= '9' ? (event.key === '0' ? 9 : Number(event.key) - 1) : -1;
        if (paletteIndex >= 0 && paletteIndex < store.palette.length) {
            event.preventDefault();
            store.setForeground(store.palette[paletteIndex]);
            return;
        }
        if (event.key === 'Delete' || event.key === 'Backspace') {
            // With a timeline frame focused (last click was on the frame
            // strip), Delete removes that frame instead of the layer/selection.
            if (store.settings.animationMode && store.frameFocus && store.frameCount > 1) {
                event.preventDefault();
                commitFloating();
                store.deleteFrame(store.currentFrame);
                return;
            }
            // With a layer row focused (last click was on the Layers list),
            // Delete removes the layer instead of the selection.
            if (store.layerFocus && store.layers.length > 1) {
                event.preventDefault();
                commitFloating();
                store.deleteLayer();
                return;
            }
            if (isFloating()) {
                commitFloating();
            }
            if (store.selection) {
                event.preventDefault();
                store.deleteSelection();
            }
            return;
        }
        if (event.key === 'Escape') {
            if (store.symmetry.transformMode) {
                hooks.clearSymmetryDrag();
            } else if (isFloating()) {
                cancelFloating();
            } else {
                store.clearSelection();
            }
            return;
        }
        if (event.key === 'Enter') {
            if (isFloating()) {
                commitFloating();
            }
            return;
        }
        if (event.key === ' ') {
            event.preventDefault();
            if (store.settings.animationMode) {
                hooks.getTimeline()?.togglePlay();
            } else {
                hooks.setSpaceHeld(true);
            }
            return;
        }
        if (event.key === '[') {
            const step = store.brushSize <= 10 ? 1 : 2;
            store.setBrushSize(Math.max(1, store.brushSize - step));
            return;
        }
        if (event.key === ']') {
            const step = store.brushSize <= 10 ? 1 : 2;
            store.setBrushSize(Math.min(500, store.brushSize + step));
            return;
        }
        const tool = toolForShortcut(event.key);
        if (tool) {
            event.preventDefault();
            hooks.selectTool(tool);
        }
    });

    window.addEventListener('keyup', (event) => {
        if (event.key === ' ') {
            hooks.setSpaceHeld(false);
        }
    });
}
