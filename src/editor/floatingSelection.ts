import { store } from '../appStore';
import {
    bakeFloating,
    bakeFloatingPart,
    Bounds,
    Box,
    BoxHit,
    boxCorners,
    boxFromBounds,
    boxFromFloating,
    compositeOverLayer,
    computeScale,
    Floating,
    FloatingPart,
    liftSelection,
    selectionBounds,
} from '../core/floating';
import { flattenLayers, Layer } from '../core/layers';
import { createEmptyImage } from '../shared/image';
import { rectSelection, Selection } from '../core/selection';

// Floating selection: pixels lifted off the active layer that can be moved,
// scaled and rotated before they are baked back (or cancelled).

export interface TransformDrag {
    mode: 'move' | 'scale' | 'rotate';
    handle: Exclude<BoxHit, null>;
    startX: number;
    startY: number;
    startCx: number;
    startCy: number;
    startScaleX: number;
    startScaleY: number;
    startAngle: number;
    startRotation: number;
}

let floating: Floating | null = null;
let transformDrag: TransformDrag | null = null;

// When the floating holds several layers (Move tool with a multi-selection),
// one piece per layer so each is baked back into the layer it came from.
let floatingParts: { nodeId: number; part: FloatingPart }[] | null = null;

let cachedBoundsMask: Selection | null = null;
let cachedBounds: ReturnType<typeof selectionBounds> = null;

// The exact selection mask captured when a floating move/copy began, plus the
// floating's initial center, so it can be transformed to follow the content.
let floatingMask: Selection | null = null;
let floatingOriginCx = 0;
let floatingOriginCy = 0;
// True when the floating holds the whole active layer (Move tool with no
// selection); committing then leaves no selection behind.
let floatingWholeLayer = false;

export function isFloating(): boolean {
    return floating !== null;
}

export function getFloating(): Floating | null {
    return floating;
}

export function isTransforming(): boolean {
    return transformDrag !== null;
}

export function getTransformDrag(): TransformDrag | null {
    return transformDrag;
}

export function endTransformDrag(): void {
    transformDrag = null;
}

export function selectionBoundsCached(): ReturnType<typeof selectionBounds> {
    if (cachedBoundsMask === store.selection) {
        return cachedBounds;
    }
    cachedBoundsMask = store.selection;
    cachedBounds = store.selection ? selectionBounds(store.selection, store.width, store.height) : null;
    return cachedBounds;
}

// Bounding box of a layer's non-transparent pixels, in layer coordinates
// (null when the layer is completely transparent).
function alphaBounds(image: ImageData): Bounds | null {
    const { width, height, data } = image;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
        const rowStart = y * width * 4;
        let rowMinX = -1;
        let rowMaxX = -1;
        for (let x = 0; x < width; x++) {
            if (data[rowStart + x * 4 + 3] !== 0) {
                if (rowMinX < 0) {
                    rowMinX = x;
                }
                rowMaxX = x;
            }
        }
        if (rowMinX < 0) {
            continue;
        }
        if (rowMinX < minX) minX = rowMinX;
        if (rowMaxX > maxX) maxX = rowMaxX;
        if (y < minY) minY = y;
        maxY = y;
    }
    if (maxX < 0) {
        return null;
    }
    return { x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1 };
}

// The content bounds scan is O(w*h) and currentBox() runs on every overlay
// redraw and hover, so results are cached per image for the current store
// revision (revisions only increase, so a hit means the pixels did not change).
let cachedContentBounds = new WeakMap<ImageData, Bounds | null>();
let cachedContentRevision = -1;

function layerContentBounds(image: ImageData): Bounds | null {
    if (cachedContentRevision !== store.revision) {
        cachedContentRevision = store.revision;
        cachedContentBounds = new WeakMap();
    }
    if (cachedContentBounds.has(image)) {
        return cachedContentBounds.get(image)!;
    }
    const bounds = alphaBounds(image);
    cachedContentBounds.set(image, bounds);
    return bounds;
}

// The layers the Move tool acts on: every layer of the selected nodes (a
// multi-selection moves and transforms them together), or the active layer on
// its own.
export function moveToolLayers(): Layer[] {
    const selected = store.topLevelSelectedNodes();
    if (selected.length > 0) {
        const layers = selected.flatMap((node) => flattenLayers([node]));
        if (layers.length > 0) {
            return layers;
        }
    }
    const active = store.activeLayer;
    return active ? [active] : [];
}

// Union of the layers' visible content in document coordinates.
function contentBoxOf(layers: Layer[]): Box | null {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const layer of layers) {
        if (layer.image.width === 0 || layer.image.height === 0) {
            continue;
        }
        const content = layerContentBounds(layer.image);
        if (!content) {
            continue;
        }
        x0 = Math.min(x0, layer.offsetX + content.x0);
        y0 = Math.min(y0, layer.offsetY + content.y0);
        x1 = Math.max(x1, layer.offsetX + content.x1);
        y1 = Math.max(y1, layer.offsetY + content.y1);
    }
    if (x1 <= x0 || y1 <= y0) {
        return null;
    }
    return boxFromBounds({ x0, y0, x1, y1 });
}

export function currentBox(): Box | null {
    if (floating) {
        return boxFromFloating(floating);
    }
    if (store.activeTool === 'move') {
        const bounds = selectionBoundsCached();
        if (bounds) {
            return boxFromBounds(bounds);
        }
        // Without a selection the box frames the visible content of the layer
        // (or of every selected layer), so its handles can scale/rotate just
        // the drawn pixels.
        const box = contentBoxOf(moveToolLayers());
        if (box) {
            return box;
        }
    }
    if (store.activeTool === 'resize' && store.width > 0) {
        return { cx: store.width / 2, cy: store.height / 2, w: store.width, h: store.height, rotation: 0 };
    }
    return null;
}

// Lifts the selected pixels of the active layer into a floating selection.
// With `copy` the layer keeps its pixels.
function liftToFloating(copy: boolean): boolean {
    const layer = store.activeLayer;
    if (!layer || !store.selection) {
        return false;
    }
    const result = liftSelection(
        layer.image,
        store.selection,
        layer.offsetX,
        layer.offsetY,
        store.width,
        store.height,
        copy,
    );
    if (!result) {
        return false;
    }
    store.pushHistory();
    store.replaceActiveLayer({ ...layer, image: result.cleared });
    floating = result.floating;
    floatingParts = null;
    floatingMask = store.selection;
    floatingOriginCx = result.floating.cx;
    floatingOriginCy = result.floating.cy;
    store.notify();
    return true;
}

// Lifts the whole layer's visible content into a floating (Move tool without a
// selection), so the box handles can scale/rotate it. With `copy` the layer
// keeps its pixels.
function liftWholeLayerToFloating(layer: Layer, copy: boolean): boolean {
    if (store.width <= 0 || store.height <= 0) {
        return false;
    }
    const content = layerContentBounds(layer.image);
    if (!content) {
        return false;
    }
    const x0 = Math.max(0, layer.offsetX + content.x0);
    const y0 = Math.max(0, layer.offsetY + content.y0);
    const x1 = Math.min(store.width, layer.offsetX + content.x1);
    const y1 = Math.min(store.height, layer.offsetY + content.y1);
    if (x1 <= x0 || y1 <= y0) {
        return false;
    }
    const mask = rectSelection(store.width, store.height, x0, y0, x1 - 1, y1 - 1);
    const result = liftSelection(
        layer.image,
        mask,
        layer.offsetX,
        layer.offsetY,
        store.width,
        store.height,
        copy,
    );
    if (!result) {
        return false;
    }
    store.pushHistory();
    store.replaceActiveLayer({ ...layer, image: result.cleared });
    floating = result.floating;
    floatingParts = null;
    floatingMask = null;
    floatingWholeLayer = true;
    floatingOriginCx = result.floating.cx;
    floatingOriginCy = result.floating.cy;
    store.notify();
    return true;
}

// Lifts the visible content of several layers into one floating (Move tool with
// a multi-selection). Every layer keeps its own piece, so the transform is
// written back into the original layers on commit instead of merging them.
function liftLayersToFloating(layers: Layer[], copy: boolean): boolean {
    if (layers.length < 2 || store.width <= 0 || store.height <= 0) {
        return false;
    }
    const pieces: { layer: Layer; x0: number; y0: number; x1: number; y1: number }[] = [];
    for (const layer of layers) {
        if (layer.image.width === 0 || layer.image.height === 0) {
            continue;
        }
        const content = layerContentBounds(layer.image);
        if (!content) {
            continue;
        }
        const x0 = Math.max(0, layer.offsetX + content.x0);
        const y0 = Math.max(0, layer.offsetY + content.y0);
        const x1 = Math.min(store.width, layer.offsetX + content.x1);
        const y1 = Math.min(store.height, layer.offsetY + content.y1);
        if (x1 <= x0 || y1 <= y0) {
            continue;
        }
        pieces.push({ layer, x0, y0, x1, y1 });
    }
    if (pieces.length === 0) {
        return false;
    }
    const ux0 = Math.min(...pieces.map((piece) => piece.x0));
    const uy0 = Math.min(...pieces.map((piece) => piece.y0));
    const ux1 = Math.max(...pieces.map((piece) => piece.x1));
    const uy1 = Math.max(...pieces.map((piece) => piece.y1));
    const unionW = ux1 - ux0;
    const unionH = uy1 - uy0;
    const cx = (ux0 + ux1) / 2;
    const cy = (uy0 + uy1) / 2;

    const bufferCanvas = document.createElement('canvas');
    bufferCanvas.width = unionW;
    bufferCanvas.height = unionH;
    const bufferContext = bufferCanvas.getContext('2d')!;

    const parts: { nodeId: number; part: FloatingPart }[] = [];
    const cleared = new Map<number, ImageData>();
    for (const piece of pieces) {
        const mask = rectSelection(store.width, store.height, piece.x0, piece.y0, piece.x1 - 1, piece.y1 - 1);
        const result = liftSelection(
            piece.layer.image,
            mask,
            piece.layer.offsetX,
            piece.layer.offsetY,
            store.width,
            store.height,
            copy,
        );
        if (!result) {
            continue;
        }
        parts.push({
            nodeId: piece.layer.id,
            part: {
                buffer: result.floating.buffer,
                localCx: (piece.x0 + piece.x1) / 2 - cx,
                localCy: (piece.y0 + piece.y1) / 2 - cy,
            },
        });
        if (!copy) {
            cleared.set(piece.layer.id, result.cleared);
        }
        // The pieces share one transform, so the display buffer is simply all
        // of them drawn at their original spots.
        const pieceCanvas = document.createElement('canvas');
        pieceCanvas.width = result.floating.buffer.width;
        pieceCanvas.height = result.floating.buffer.height;
        pieceCanvas.getContext('2d')!.putImageData(result.floating.buffer, 0, 0);
        bufferContext.drawImage(pieceCanvas, piece.x0 - ux0, piece.y0 - uy0);
    }
    if (parts.length === 0) {
        return false;
    }

    store.pushHistory();
    for (const [id, image] of cleared) {
        const layer = layers.find((entry) => entry.id === id);
        if (layer) {
            store.replaceLayer({ ...layer, image });
        }
    }
    floating = {
        buffer: bufferContext.getImageData(0, 0, unionW, unionH),
        originW: unionW,
        originH: unionH,
        cx,
        cy,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
    };
    floatingParts = parts;
    floatingMask = null;
    floatingWholeLayer = true;
    floatingOriginCx = cx;
    floatingOriginCy = cy;
    store.notify();
    return true;
}

// Lifts whatever the Move tool acts on: all selected layers together, or the
// single layer's content.
function liftMoveTargetsToFloating(copy: boolean): boolean {
    const layers = moveToolLayers();
    if (layers.length === 0) {
        return false;
    }
    if (layers.length === 1) {
        return liftWholeLayerToFloating(layers[0], copy);
    }
    return liftLayersToFloating(layers, copy);
}

// Copies the selected pixels (or the floating selection) to the clipboard as a
// PNG. Returns false if there is nothing selected or the clipboard API is
// unavailable.
export async function copySelectionToClipboard(): Promise<boolean> {
    if (typeof ClipboardItem === 'undefined' || !navigator.clipboard || !navigator.clipboard.write) {
        return false;
    }
    let source: ImageData;
    let x0: number;
    let y0: number;
    let x1: number;
    let y1: number;

    if (floating) {
        source = bakeFloating(floating, store.width, store.height);
        const corners = boxCorners(boxFromFloating(floating));
        const xs = corners.map((corner) => corner.x);
        const ys = corners.map((corner) => corner.y);
        x0 = Math.max(0, Math.floor(Math.min(...xs)));
        y0 = Math.max(0, Math.floor(Math.min(...ys)));
        x1 = Math.min(store.width, Math.ceil(Math.max(...xs)));
        y1 = Math.min(store.height, Math.ceil(Math.max(...ys)));
    } else {
        const bounds = selectionBoundsCached();
        const composite = store.current;
        if (!bounds || !composite) {
            return false;
        }
        source = composite;
        x0 = bounds.x0;
        y0 = bounds.y0;
        x1 = bounds.x1;
        y1 = bounds.y1;
    }

    const width = x1 - x0;
    const height = y1 - y0;
    if (width <= 0 || height <= 0) {
        return false;
    }

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = source.width;
    sourceCanvas.height = source.height;
    sourceCanvas.getContext('2d')!.putImageData(source, 0, 0);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d')!.drawImage(sourceCanvas, x0, y0, width, height, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob((result) => resolve(result), 'image/png'));
    if (!blob) {
        return false;
    }
    try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
    } catch {
        return false;
    }
}

// A rectangular selection covering the (possibly rotated) floating box, so the
// selection follows the content after a move/copy and can be moved again.
function selectionForBox(box: Box): Selection | null {
    const corners = boxCorners(box);
    const xs = corners.map((corner) => corner.x);
    const ys = corners.map((corner) => corner.y);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const x1 = Math.min(store.width - 1, Math.ceil(Math.max(...xs)));
    const y1 = Math.min(store.height - 1, Math.ceil(Math.max(...ys)));
    if (x1 < x0 || y1 < y0) {
        return null;
    }
    return rectSelection(store.width, store.height, x0, y0, x1, y1);
}

// Transforms the original selection mask by the floating's translate/scale/
// rotate so the exact selected shape follows the moved content.
function transformMask(
    mask: Selection,
    originCx: number,
    originCy: number,
    f: Floating,
): Selection | null {
    const cos = Math.cos(f.rotation);
    const sin = Math.sin(f.rotation);
    const corners = boxCorners(boxFromFloating(f));
    const xs = corners.map((corner) => corner.x);
    const ys = corners.map((corner) => corner.y);
    const x0 = Math.max(0, Math.floor(Math.min(...xs)));
    const y0 = Math.max(0, Math.floor(Math.min(...ys)));
    const x1 = Math.min(store.width - 1, Math.ceil(Math.max(...xs)));
    const y1 = Math.min(store.height - 1, Math.ceil(Math.max(...ys)));
    if (x1 < x0 || y1 < y0) {
        return null;
    }
    const result = new Uint8Array(store.width * store.height);
    let count = 0;
    for (let dy = y0; dy <= y1; dy++) {
        for (let dx = x0; dx <= x1; dx++) {
            const rx = dx - f.cx;
            const ry = dy - f.cy;
            const localX = rx * cos + ry * sin;
            const localY = -rx * sin + ry * cos;
            const sourceX = originCx + localX / f.scaleX;
            const sourceY = originCy + localY / f.scaleY;
            const ix = Math.floor(sourceX);
            const iy = Math.floor(sourceY);
            if (ix < 0 || ix >= store.width || iy < 0 || iy >= store.height) {
                continue;
            }
            if (mask[ix + iy * store.width]) {
                result[dx + dy * store.width] = 1;
                count++;
            }
        }
    }
    return count > 0 ? result : null;
}

export function commitFloating(): void {
    if (!floating) {
        return;
    }
    const box = boxFromFloating(floating);
    if (floatingParts) {
        // Multi-layer float: every piece goes back into the layer it came from.
        for (const { nodeId, part } of floatingParts) {
            const layer = store.layers.find((entry) => entry.id === nodeId);
            if (!layer) {
                continue;
            }
            const baked = bakeFloatingPart(part, floating, store.width, store.height);
            const target = createEmptyImage(store.width, store.height);
            target.data.set(layer.image.data);
            compositeOverLayer(target, baked, layer.offsetX, layer.offsetY);
            store.replaceLayer({ ...layer, image: target });
        }
    } else {
        const layer = store.activeLayer;
        if (layer) {
            const baked = bakeFloating(floating, store.width, store.height);
            const target = createEmptyImage(store.width, store.height);
            target.data.set(layer.image.data);
            compositeOverLayer(target, baked, layer.offsetX, layer.offsetY);
            store.replaceActiveLayer({ ...layer, image: target });
        }
    }
    const transformed = floatingWholeLayer
        ? null
        : floatingMask
          ? transformMask(floatingMask, floatingOriginCx, floatingOriginCy, floating)
          : selectionForBox(box);
    floating = null;
    floatingParts = null;
    floatingMask = null;
    floatingWholeLayer = false;
    store.selection = transformed;
    store.notify();
}

export function cancelFloating(): void {
    if (!floating) {
        return;
    }
    floating = null;
    floatingParts = null;
    floatingMask = null;
    floatingWholeLayer = false;
    store.clearSelection();
    store.undo();
}

// Starts a transform drag on the box handle that was hit. Lifts the selection
// (or, without one, the layer or the selected layers) into a floating first
// (`copy` keeps the original pixels, for Alt-drag).
export function startTransformDrag(hit: Exclude<BoxHit, null>, pointX: number, pointY: number, copy: boolean): void {
    if (!floating && !(store.selection ? liftToFloating(copy) : liftMoveTargetsToFloating(copy))) {
        return;
    }
    const active = currentBox()!;
    transformDrag = {
        mode: hit === 'rotate' ? 'rotate' : hit === 'inside' ? 'move' : 'scale',
        handle: hit,
        startX: pointX,
        startY: pointY,
        startCx: active.cx,
        startCy: active.cy,
        startScaleX: floating!.scaleX,
        startScaleY: floating!.scaleY,
        startAngle: Math.atan2(pointY - active.cy, pointX - active.cx),
        startRotation: active.rotation,
    };
}

export function applyTransform(x: number, y: number, shiftKey: boolean): void {
    if (!transformDrag || !floating) {
        return;
    }
    if (transformDrag.mode === 'move') {
        floating.cx = transformDrag.startCx + (x - transformDrag.startX);
        floating.cy = transformDrag.startCy + (y - transformDrag.startY);
        return;
    }
    if (transformDrag.mode === 'rotate') {
        const angle = Math.atan2(y - floating.cy, x - floating.cx);
        floating.rotation = transformDrag.startRotation + (angle - transformDrag.startAngle);
        return;
    }

    const scaled = computeScale(
        {
            cx: transformDrag.startCx,
            cy: transformDrag.startCy,
            scaleX: transformDrag.startScaleX,
            scaleY: transformDrag.startScaleY,
            rotation: floating.rotation,
            originW: floating.originW,
            originH: floating.originH,
        },
        transformDrag.handle,
        x,
        y,
        shiftKey,
    );
    floating.cx = scaled.cx;
    floating.cy = scaled.cy;
    floating.scaleX = scaled.scaleX;
    floating.scaleY = scaled.scaleY;
}
