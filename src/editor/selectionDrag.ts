import { store } from '../appStore';
import { combineSelection, polygonSelection, rectSelection, Selection, SelectionMode } from '../core/selection';

// In-progress marquee/lasso drag. The outline is drawn while dragging; the
// real mask is only built when the drag ends, so dragging stays smooth even on
// large documents.

export interface SelectionDrag {
    type: 'marquee' | 'lasso';
    startX: number;
    startY: number;
    startClientX: number;
    startClientY: number;
    currentX: number;
    currentY: number;
    moved: boolean;
    points: { x: number; y: number }[];
}

let drag: SelectionDrag | null = null;
// Selection boolean mode and base mask captured when a selection drag starts.
let base: Selection | null = null;
let mode: SelectionMode = 'replace';

export function selectionModeFor(event: PointerEvent): SelectionMode {
    if (event.shiftKey) {
        return 'add';
    }
    if (event.altKey) {
        return 'subtract';
    }
    return 'replace';
}

export function startSelectionDrag(
    type: 'marquee' | 'lasso',
    point: { x: number; y: number },
    clientX: number,
    clientY: number,
    selectionMode: SelectionMode,
): void {
    base = store.selection;
    mode = selectionMode;
    drag = {
        type,
        startX: point.x,
        startY: point.y,
        startClientX: clientX,
        startClientY: clientY,
        currentX: point.x,
        currentY: point.y,
        moved: false,
        points: type === 'lasso' ? [{ x: point.x, y: point.y }] : [],
    };
}

export function isSelecting(): boolean {
    return drag !== null;
}

export function getSelectionDrag(): SelectionDrag | null {
    return drag;
}

export function updateSelectionDrag(point: { x: number; y: number }, clientX: number, clientY: number): void {
    if (!drag) {
        return;
    }
    drag.currentX = point.x;
    drag.currentY = point.y;
    if (Math.abs(clientX - drag.startClientX) + Math.abs(clientY - drag.startClientY) > 3) {
        drag.moved = true;
    }
    if (drag.type === 'lasso') {
        const last = drag.points[drag.points.length - 1];
        if (Math.hypot(point.x - last.x, point.y - last.y) > 1) {
            drag.points.push({ x: point.x, y: point.y });
        }
    }
}

export function finishSelectionDrag(): void {
    if (!drag) {
        return;
    }
    const finished = drag;
    const baseSelection = base;
    const finishedMode = mode;
    drag = null;
    base = null;
    if (finished.type === 'marquee' && !finished.moved) {
        // A plain click with the marquee clears the selection.
        store.clearSelection();
    } else {
        const mask =
            finished.type === 'marquee'
                ? rectSelection(store.width, store.height, finished.startX, finished.startY, finished.currentX, finished.currentY)
                : polygonSelection(store.width, store.height, finished.points);
        store.setSelection(combineSelection(baseSelection, mask, finishedMode));
    }
}
