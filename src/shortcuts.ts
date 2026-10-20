import { store } from './appStore';
import { allBrushes } from './core/brushLibrary';
import { isGroup } from './core/layers';
import { cancelFloating, commitFloating, copySelectionToClipboard, isFloating, nudgeMove } from './editor/floatingSelection';
import { clearMeasurement } from './editor/measure';
import { isBrushTool } from './editor/paint';
import { backspaceText, cancelText, commitText, isTextEditing, typeText } from './editor/textTool';
import { ToolId, toolForShortcut } from './core/tools';
import { Timeline } from './ui/timeline';

// Global keyboard shortcuts. Actions that belong to the app wiring (saving,
// tool selection, playback, space-pan state) are injected via hooks.

// Arrow-key nudges for the Move tool (one pixel per press).
const ARROW_STEPS: Record<string, [number, number] | undefined> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
};

// Position of a digit key press (1-9, 0 = tenth), or -1. Reads `code` so the
// main-row digits keep working with Shift held (where `key` becomes '!' etc.).
function digitIndex(event: KeyboardEvent): number {
    const match = /^Digit([0-9])$/.exec(event.code);
    const digit = match?.[1] ?? (/^[0-9]$/.test(event.key) ? event.key : null);
    if (digit === null) {
        return -1;
    }
    return digit === '0' ? 9 : Number(digit) - 1;
}

export interface ShortcutHooks {
    saveDocument(): void;
    selectTool(tool: ToolId): void;
    getTimeline(): Timeline | null;
    clearSymmetryDrag(): void;
    setSpaceHeld(held: boolean): void;
    // Starts the inline rename of the active layer (Ctrl+R).
    renameLayer(): void;
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
        if (ctrl && event.key.toLowerCase() === 'r' && !event.shiftKey) {
            // Rename the active layer instead of reloading the page while a
            // document is open (the mini list or the Layers panel starts the
            // inline rename).
            if (store.current === null) {
                return;
            }
            event.preventDefault();
            hooks.renameLayer();
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
        // Move tool: arrow keys nudge the moving content; Shift moves ten
        // pixels per press.
        if (store.activeTool === 'move' && !event.altKey) {
            const step = ARROW_STEPS[event.key];
            if (step) {
                event.preventDefault();
                const distance = event.shiftKey ? 10 : 1;
                nudgeMove(step[0] * distance, step[1] * distance);
                return;
            }
        }
        // Number keys pick palette colors (1-9, 0 = tenth); with Shift they pick
        // a brush from the library instead, while a brush tool is active.
        const digit = digitIndex(event);
        if (digit >= 0) {
            if (event.shiftKey && isBrushTool(store.activeTool)) {
                const brushes = allBrushes();
                if (digit < brushes.length) {
                    event.preventDefault();
                    store.setBrush(brushes[digit].id);
                    return;
                }
            }
            if (!event.shiftKey && digit < store.palette.length) {
                event.preventDefault();
                store.setForeground(store.palette[digit]);
                return;
            }
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
            } else if (store.activeTool === 'measure' && clearMeasurement()) {
                store.emit();
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
