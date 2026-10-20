import { store } from '../appStore';
import { brushFootprint } from '../core/brushes';
import { clamp, RGB } from '../shared/color';
import { h } from '../shared/dom';
import { drawBoxToContext, drawFloatingToContext } from '../core/floating';
import { currentBox, getFloating, selectionBoundsCached } from './floatingSelection';
import { getPixel } from '../shared/image';
import { drawSymmetryToContext } from '../core/modifiers';
import { getMeasurement, measurementDistance } from './measure';
import { getCloneMarker, isBrushTool } from './paint';
import { selectionOverlay } from '../core/selection';
import { getSelectionDrag } from './selectionDrag';
import { getTextEditing, isCaretOn, textFontString } from './textTool';
import { getActiveColorPicker } from '../ui/selectColor';

// Canvas view: the canvas stack (image + overlay), zoom/pan, the minimap,
// hover/sample previews and every transient overlay (selection, floating
// content, transform box, symmetry guide, text caret, brush cursor).

// --- Canvas elements ---

export const canvas = h('canvas', { class: 'main-canvas' });
const overlayCanvas = h('canvas', { class: 'overlay-canvas' });
// Measure graphics are DOM elements (line, endpoint dots, distance label) so
// they stay crisp and screen-sized at any zoom — the overlay canvas is
// document-resolution and pixelated when scaled up.
const measureLine = h('div', { class: 'measure-line' });
const measureStartDot = h('div', { class: 'measure-dot' });
const measureEndDot = h('div', { class: 'measure-dot' });
const measureLabel = h('div', { class: 'measure-label' });
const measureLayer = h('div', { class: 'measure-layer' }, [
    measureLine,
    measureStartDot,
    measureEndDot,
    measureLabel,
]);
const canvasStack = h('div', { class: 'canvas-stack' }, [canvas, overlayCanvas, measureLayer]);
// Filled by the app wiring with the start screen (quick actions + recent
// files) while no document is open.
export const canvasPlaceholder = h('div', { class: 'placeholder' });
export const canvasArea = h('div', { class: 'canvas-area' }, [canvasStack, canvasPlaceholder]);
const resizePreview = h('div', { class: 'resize-preview' });
canvasArea.append(resizePreview);
const minimapCanvas = h('canvas', { class: 'minimap-canvas' });
const minimap = h('div', { class: 'minimap' }, [minimapCanvas]);
minimap.style.display = 'none';
canvasArea.append(minimap);

const samplePreview = h('div', { class: 'sample-preview' });
document.body.append(samplePreview);

export function showSamplePreview(clientX: number, clientY: number, color: RGB): void {
    samplePreview.style.background = `rgb(${color.r}, ${color.g}, ${color.b})`;
    samplePreview.style.left = `${clientX + 16}px`;
    samplePreview.style.top = `${clientY + 16}px`;
    samplePreview.classList.add('visible');
}

export function hideSamplePreview(): void {
    samplePreview.classList.remove('visible');
}

// The zoom readout lives in the options bar but is driven by the layout code.
export const zoomLabel = h('span', { class: 'row-label' });

// --- Zoom / pan state ---

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 40;
const ZOOM_STEP = 1.15;

let zoom = 1;
let offsetX = 0;
let offsetY = 0;
let lastWidth = 0;
let lastHeight = 0;
let lastRevision = -1;
// Display scale the overlay canvas was last drawn at. Overlay elements such as
// the selection border and the transform box are sized for the zoom level, so
// they must be redrawn whenever this changes.
let overlayScale = -1;
// False whenever the main canvas was cleared (resized) or has no content, so
// the renderer knows a partial (dirty rectangle) update is not enough.
let canvasValid = false;

function fitScale(img: ImageData): number {
    const area = canvasArea.getBoundingClientRect();
    return Math.min(1, area.width / img.width, area.height / img.height);
}

export function currentScale(img: ImageData): number {
    return fitScale(img) * zoom;
}

export function displayScale(): number {
    const img = store.current;
    return img ? currentScale(img) : 1;
}

export function hitTolerance(): number {
    return Math.max(4, 8 / Math.max(displayScale(), 0.02));
}

export function handleHalfSize(): number {
    return Math.max(2, 4 / Math.max(displayScale(), 0.02));
}

export function applyCanvasLayout(): void {
    const img = store.current;
    if (!img) {
        return;
    }
    const area = canvasArea.getBoundingClientRect();
    const scale = currentScale(img);
    const displayedWidth = img.width * scale;
    const displayedHeight = img.height * scale;
    const maxX = Math.max(0, (displayedWidth - area.width) / 2);
    const maxY = Math.max(0, (displayedHeight - area.height) / 2);
    offsetX = clamp(offsetX, -maxX, maxX);
    offsetY = clamp(offsetY, -maxY, maxY);
    canvasStack.style.width = `${displayedWidth}px`;
    canvasStack.style.height = `${displayedHeight}px`;
    canvasStack.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;
    renderMinimap();
    // The selection border and transform box are sized for the zoom level, so
    // zooming in or out has to regenerate the overlay.
    if (scale !== overlayScale) {
        redrawOverlay();
    }
}

export function panBy(dx: number, dy: number): void {
    offsetX += dx;
    offsetY += dy;
}

// The move-drag preview paints the composite straight onto the canvas, so the
// content is trustworthy for dirty-rect updates again.
export function markCanvasValid(): void {
    canvasValid = true;
}

export function fitToView(): void {
    zoom = 1;
    offsetX = 0;
    offsetY = 0;
    applyCanvasLayout();
}

export function zoomToScale(scaleFactor: number): void {
    const img = store.current;
    if (!img) {
        return;
    }
    const fit = fitScale(img) || 1;
    zoom = clamp(scaleFactor / fit, MIN_ZOOM, MAX_ZOOM);
    offsetX = 0;
    offsetY = 0;
    applyCanvasLayout();
}

export function zoomAtPoint(clientX: number, clientY: number, factor: number): void {
    const img = store.current;
    if (!img) {
        return;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
        return;
    }
    const area = canvasArea.getBoundingClientRect();
    const areaCenterX = area.left + area.width / 2;
    const areaCenterY = area.top + area.height / 2;
    const relX = (clientX - rect.left) / rect.width;
    const relY = (clientY - rect.top) / rect.height;
    zoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
    const scale = currentScale(img);
    const displayedWidth = img.width * scale;
    const displayedHeight = img.height * scale;
    offsetX = clientX - relX * displayedWidth - areaCenterX + displayedWidth / 2;
    offsetY = clientY - relY * displayedHeight - areaCenterY + displayedHeight / 2;
    applyCanvasLayout();
}

export function toImagePoint(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
        x: ((clientX - rect.left) / rect.width) * store.width,
        y: ((clientY - rect.top) / rect.height) * store.height,
    };
}

// --- Minimap (optional overview in the bottom-right corner) ---

const MINIMAP_MAX_WIDTH = 160;
const MINIMAP_MAX_HEIGHT = 120;

let minimapDragging = false;

// Centers the view on a document point; used when clicking or dragging on the
// minimap.
function panToImagePoint(docX: number, docY: number): void {
    const img = store.current;
    if (!img) {
        return;
    }
    const scale = currentScale(img);
    offsetX = (img.width / 2 - docX) * scale;
    offsetY = (img.height / 2 - docY) * scale;
    applyCanvasLayout();
}

function panFromMinimap(event: PointerEvent): void {
    const img = store.current;
    if (!img) {
        return;
    }
    const rect = minimapCanvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
        return;
    }
    const relX = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const relY = clamp((event.clientY - rect.top) / rect.height, 0, 1);
    panToImagePoint(relX * img.width, relY * img.height);
}

minimapCanvas.addEventListener('pointerdown', (event) => {
    if (!store.current) {
        return;
    }
    minimapDragging = true;
    minimapCanvas.setPointerCapture(event.pointerId);
    panFromMinimap(event);
    event.preventDefault();
});

minimapCanvas.addEventListener('pointermove', (event) => {
    if (minimapDragging) {
        panFromMinimap(event);
    }
});

function endMinimapDrag(event: PointerEvent): void {
    minimapDragging = false;
    if (minimapCanvas.hasPointerCapture(event.pointerId)) {
        minimapCanvas.releasePointerCapture(event.pointerId);
    }
}
minimapCanvas.addEventListener('pointerup', endMinimapDrag);
minimapCanvas.addEventListener('pointercancel', endMinimapDrag);

// Draws the document preview and the current viewport rectangle. Called from
// applyCanvasLayout (pan/zoom/resize) and refreshCanvas (content changes) so it
// always reflects what is on screen.
const minimapThumb = document.createElement('canvas');
let minimapThumbRevision = -1;
// Signature of the drawn state, so the double call per render (layout +
// render itself) does not redraw the same minimap twice.
let minimapSignature = '';

function renderMinimap(): void {
    const img = store.current;
    const enabled = store.settings.minimap && img !== null;
    minimap.style.display = enabled ? 'block' : 'none';
    if (!img || !enabled) {
        minimapSignature = '';
        return;
    }
    const area = canvasArea.getBoundingClientRect();
    const signature = `${store.revision}|${zoom}|${offsetX}|${offsetY}|${area.width}|${area.height}`;
    if (signature === minimapSignature) {
        return;
    }
    minimapSignature = signature;
    const mapScale = Math.min(MINIMAP_MAX_WIDTH / img.width, MINIMAP_MAX_HEIGHT / img.height, 1);
    const mapWidth = Math.max(1, Math.round(img.width * mapScale));
    const mapHeight = Math.max(1, Math.round(img.height * mapScale));
    const dpr = window.devicePixelRatio || 1;
    const canvasWidth = Math.round(mapWidth * dpr);
    const canvasHeight = Math.round(mapHeight * dpr);
    if (minimapCanvas.width !== canvasWidth || minimapCanvas.height !== canvasHeight) {
        minimapCanvas.width = canvasWidth;
        minimapCanvas.height = canvasHeight;
    }
    minimapCanvas.style.width = `${mapWidth}px`;
    minimapCanvas.style.height = `${mapHeight}px`;
    const context = minimapCanvas.getContext('2d');
    if (!context) {
        return;
    }
    // The downscaled document is cached and only refreshed when the content
    // changes, so panning just blits the cached thumbnail and the viewport rect.
    if (minimapThumbRevision !== store.revision || minimapThumb.width !== canvasWidth || minimapThumb.height !== canvasHeight) {
        minimapThumbRevision = store.revision;
        minimapThumb.width = canvasWidth;
        minimapThumb.height = canvasHeight;
        const thumbContext = minimapThumb.getContext('2d');
        if (thumbContext) {
            thumbContext.setTransform(dpr, 0, 0, dpr, 0, 0);
            thumbContext.imageSmoothingEnabled = true;
            thumbContext.drawImage(canvas, 0, 0, mapWidth, mapHeight);
        }
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, mapWidth, mapHeight);
    context.drawImage(minimapThumb, 0, 0, mapWidth, mapHeight);

    // Viewport rectangle: the visible document region mapped into minimap space.
    const scale = currentScale(img);
    const left = area.width / 2 - (img.width * scale) / 2 + offsetX;
    const top = area.height / 2 - (img.height * scale) / 2 + offsetY;
    const x0 = clamp(-left / scale, 0, img.width);
    const y0 = clamp(-top / scale, 0, img.height);
    const x1 = clamp((area.width - left) / scale, 0, img.width);
    const y1 = clamp((area.height - top) / scale, 0, img.height);
    const rectX = (x0 / img.width) * mapWidth;
    const rectY = (y0 / img.height) * mapHeight;
    const rectW = Math.max(2, ((x1 - x0) / img.width) * mapWidth);
    const rectH = Math.max(2, ((y1 - y0) / img.height) * mapHeight);
    context.fillStyle = 'rgba(255, 255, 255, 0.18)';
    context.fillRect(rectX, rectY, rectW, rectH);
    context.strokeStyle = '#ffffff';
    context.lineWidth = 1;
    context.strokeRect(rectX + 0.5, rectY + 0.5, Math.max(1, rectW - 1), Math.max(1, rectH - 1));
}

// --- Color sampling ---

export function sampleColorAt(img: ImageData, x: number, y: number): RGB {
    const px = clamp(Math.floor(x), 0, img.width - 1);
    const py = clamp(Math.floor(y), 0, img.height - 1);
    return getPixel(img, px, py);
}

// Samples a color, routes it to the active color picker (or the foreground)
// and shows the swatch preview. Shared by the eyedropper and Alt+brush/bucket.
export function sampleAt(img: ImageData, x: number, y: number, clientX: number, clientY: number): void {
    const color = sampleColorAt(img, x, y);
    const picker = getActiveColorPicker();
    if (picker) {
        picker(color);
    } else {
        store.setForeground(color);
    }
    showSamplePreview(clientX, clientY, color);
}

// --- Selection overlay ---

let cachedSelectionMask: Uint8Array | null = null;
let cachedSelectionThickness = 1;
let cachedSelectionCanvas: { canvas: HTMLCanvasElement; x: number; y: number } | null = null;

// Marching-ants border width in document pixels, chosen so the outline stays
// roughly two screen pixels wide even when zoomed far out.
function selectionThickness(): number {
    const img = store.current;
    const scale = img ? currentScale(img) : 1;
    return Math.max(1, Math.ceil(1.5 / Math.max(scale, 0.02)));
}

// The selection border is only rasterized around the selection's bounds, so
// this returns a small canvas plus the document-space position to draw it at.
function getSelectionCanvas(mask: Uint8Array): { canvas: HTMLCanvasElement; x: number; y: number } | null {
    const thickness = selectionThickness();
    if (cachedSelectionMask === mask && cachedSelectionThickness === thickness && cachedSelectionCanvas) {
        return cachedSelectionCanvas;
    }
    const bounds = selectionBoundsCached();
    if (!bounds) {
        return null;
    }
    const region = selectionOverlay(mask, store.width, store.height, thickness, bounds);
    const canvas = document.createElement('canvas');
    canvas.width = region.image.width;
    canvas.height = region.image.height;
    canvas.getContext('2d')!.putImageData(region.image, 0, 0);
    cachedSelectionMask = mask;
    cachedSelectionThickness = thickness;
    cachedSelectionCanvas = { canvas, x: region.x, y: region.y };
    return cachedSelectionCanvas;
}

// --- Onion skin (previous frame shown under the current one) ---

let cachedOnionKey = '';
let cachedOnionCanvas: HTMLCanvasElement | null = null;

function getOnionCanvas(index: number): HTMLCanvasElement | null {
    const image = store.frameComposite(index);
    if (!image) {
        return null;
    }
    const key = `${store.frameId(index)}:${store.frameRevision(index)}`;
    if (key === cachedOnionKey && cachedOnionCanvas) {
        return cachedOnionCanvas;
    }
    const element = document.createElement('canvas');
    element.width = image.width;
    element.height = image.height;
    element.getContext('2d')!.putImageData(image, 0, 0);
    cachedOnionKey = key;
    cachedOnionCanvas = element;
    return element;
}

let hoverPoint: { x: number; y: number } | null = null;

export function setHoverPoint(point: { x: number; y: number } | null): void {
    hoverPoint = point;
}

// Draws the in-progress marquee/lasso outline. The real mask is only built
// when the drag ends, so dragging stays smooth even on large documents.
function drawSelectionPreview(context: CanvasRenderingContext2D): void {
    const selecting = getSelectionDrag();
    if (!selecting) {
        return;
    }
    const lineWidth = Math.max(1, 1.5 / Math.max(displayScale(), 0.02));
    context.save();
    context.beginPath();
    if (selecting.type === 'marquee') {
        context.rect(
            Math.min(selecting.startX, selecting.currentX),
            Math.min(selecting.startY, selecting.currentY),
            Math.abs(selecting.currentX - selecting.startX),
            Math.abs(selecting.currentY - selecting.startY),
        );
    } else if (selecting.points.length > 0) {
        context.moveTo(selecting.points[0].x, selecting.points[0].y);
        for (let i = 1; i < selecting.points.length; i++) {
            context.lineTo(selecting.points[i].x, selecting.points[i].y);
        }
        context.lineTo(selecting.currentX, selecting.currentY);
    }
    context.setLineDash([lineWidth * 4, lineWidth * 4]);
    for (const [width, color] of [
        [3, 'rgba(0, 0, 0, 0.75)'],
        [1, 'rgba(255, 255, 255, 0.95)'],
    ] as [number, string][]) {
        context.lineWidth = width * lineWidth;
        context.strokeStyle = color;
        context.stroke();
    }
    context.restore();
}

export function redrawOverlay(): void {
    const context = overlayCanvas.getContext('2d');
    if (!context) {
        return;
    }
    overlayScale = displayScale();
    context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (
        store.settings.onionSkin &&
        store.settings.animationMode &&
        !store.playing &&
        store.currentFrame > 0
    ) {
        const skin = getOnionCanvas(store.currentFrame - 1);
        if (skin) {
            context.save();
            context.globalAlpha = clamp(store.settings.onionOpacity, 0, 1);
            context.imageSmoothingEnabled = false;
            context.drawImage(skin, 0, 0);
            context.restore();
        }
    }
    const floating = getFloating();
    if (floating) {
        drawFloatingToContext(context, floating);
    } else if (store.selection && store.width > 0) {
        const selection = getSelectionCanvas(store.selection);
        if (selection) {
            context.drawImage(selection.canvas, selection.x, selection.y);
        }
    }
    if (getSelectionDrag()) {
        drawSelectionPreview(context);
    }
    const box = store.activeTool === 'move' || store.activeTool === 'resize' ? currentBox() : null;
    if (box) {
        // Thicken the box lines when zoomed out so they do not disappear.
        drawBoxToContext(context, box, handleHalfSize(), Math.max(1, 1 / Math.max(displayScale(), 0.02)));
    }
    const measurement = store.activeTool === 'measure' && store.width > 0 && store.height > 0 ? getMeasurement() : null;
    if (measurement) {
        // Screen positions come from the displayed scale so the line, dots and
        // label keep their on-screen size at every zoom level.
        const scale = displayScale();
        const length = Math.hypot(measurement.endX - measurement.startX, measurement.endY - measurement.startY);
        const angle = Math.atan2(measurement.endY - measurement.startY, measurement.endX - measurement.startX);
        measureLine.style.left = `${measurement.startX * scale}px`;
        measureLine.style.top = `${measurement.startY * scale}px`;
        measureLine.style.width = `${length * scale}px`;
        measureLine.style.transform = `rotate(${angle}rad)`;
        measureStartDot.style.left = `${measurement.startX * scale}px`;
        measureStartDot.style.top = `${measurement.startY * scale}px`;
        measureEndDot.style.left = `${measurement.endX * scale}px`;
        measureEndDot.style.top = `${measurement.endY * scale}px`;
        measureLabel.textContent = `${measurementDistance(measurement)} px`;
        measureLabel.style.left = `${(((measurement.startX + measurement.endX) / 2) / store.width) * 100}%`;
        measureLabel.style.top = `${(((measurement.startY + measurement.endY) / 2) / store.height) * 100}%`;
        measureLayer.classList.add('visible');
    } else {
        measureLayer.classList.remove('visible');
    }
    if (store.symmetry.enabled || store.symmetry.transformMode) {
        drawSymmetryToContext(
            context,
            store.symmetry,
            store.symmetry.transformMode,
            handleHalfSize(),
            Math.max(1, 1 / Math.max(displayScale(), 0.02)),
        );
    }
    const editing = getTextEditing();
    if (editing) {
        context.save();
        context.font = textFontString();
        context.textBaseline = 'top';
        const previewColor = store.paintColor;
        context.fillStyle = `rgb(${previewColor.r}, ${previewColor.g}, ${previewColor.b})`;
        context.fillText(editing.content, editing.x, editing.y);
        if (isCaretOn()) {
            const width = context.measureText(editing.content).width;
            context.fillStyle = 'rgba(255, 255, 255, 0.9)';
            context.fillRect(editing.x + width + 1, editing.y, Math.max(1, store.textSize * 0.06), store.textSize);
        }
        context.restore();
    }
    if (store.activeTool === 'clone') {
        const marker = getCloneMarker(hoverPoint);
        if (marker) {
            context.beginPath();
            context.arc(marker.x, marker.y, Math.max(2, store.brushSize * 0.3), 0, Math.PI * 2);
            context.lineWidth = 1;
            context.strokeStyle = 'rgba(0, 255, 255, 0.9)';
            context.stroke();
            context.beginPath();
            context.moveTo(marker.x - 4, marker.y);
            context.lineTo(marker.x + 4, marker.y);
            context.moveTo(marker.x, marker.y - 4);
            context.lineTo(marker.x, marker.y + 4);
            context.stroke();
        }
    }
    if (hoverPoint && store.current && isBrushTool(store.activeTool) && !store.symmetry.transformMode) {
        const brush = store.brush;
        if (!brush.antialias && store.activeTool !== 'knife') {
            // Show the exact pixels a hard (non-antialiased) tip will paint.
            const cx = Math.floor(hoverPoint.x);
            const cy = Math.floor(hoverPoint.y);
            for (const { dx, dy } of brushFootprint(store.brushSize, brush)) {
                const px = cx + dx;
                const py = cy + dy;
                const dark = ((px + py) & 1) === 0;
                context.fillStyle = dark ? 'rgba(0, 0, 0, 0.6)' : 'rgba(255, 255, 255, 0.6)';
                context.fillRect(px, py, 1, 1);
            }
        } else {
            const radius = Math.max(0.5, store.brushSize / 2);
            const hx = hoverPoint.x;
            const hy = hoverPoint.y;
            const drawTip = (r: number): void => {
                context.beginPath();
                context.ellipse(hx, hy, r, r * brush.roundness, brush.angle, 0, Math.PI * 2);
                context.stroke();
            };
            context.lineWidth = 3;
            context.strokeStyle = 'rgba(0, 0, 0, 0.6)';
            drawTip(radius);
            context.lineWidth = 1;
            context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
            drawTip(radius);
            // Inner ring marks where the falloff begins (the solid core).
            if (brush.hardness > 0 && brush.hardness < 1) {
                drawTip(radius * brush.hardness);
            }
        }
    }
}

// --- Resize preview (during a resize-handle drag) ---

export function showResizePreview(left: number, top: number, width: number, height: number): void {
    const rect = canvas.getBoundingClientRect();
    const areaRect = canvasArea.getBoundingClientRect();
    const sx = rect.left - areaRect.left + (left / store.width) * rect.width;
    const sy = rect.top - areaRect.top + (top / store.height) * rect.height;
    resizePreview.style.display = 'block';
    resizePreview.style.left = `${sx}px`;
    resizePreview.style.top = `${sy}px`;
    resizePreview.style.width = `${(width / store.width) * rect.width}px`;
    resizePreview.style.height = `${(height / store.height) * rect.height}px`;
}

export function hideResizePreview(): void {
    resizePreview.style.display = 'none';
}

// --- Rendering / state sync ---

// Paints the document canvas (full or dirty-rect update) and refreshes the
// layout, overlay and minimap.
export function refreshCanvas(): void {
    const img = store.current;

    if (img) {
        if (canvas.width !== img.width || canvas.height !== img.height) {
            canvas.width = img.width;
            canvas.height = img.height;
            overlayCanvas.width = img.width;
            overlayCanvas.height = img.height;
            canvasValid = false;
        }
        if (store.revision !== lastRevision) {
            lastRevision = store.revision;
            const context = canvas.getContext('2d');
            const damage = store.lastDamage;
            if (context) {
                // Local edits (strokes) only repaint their dirty rectangles; anything
                // else (or a canvas that was just cleared) needs the full image.
                if (damage && damage.length > 0 && canvasValid) {
                    for (const rect of damage) {
                        context.putImageData(img, 0, 0, rect.x, rect.y, rect.width, rect.height);
                    }
                } else {
                    context.putImageData(img, 0, 0);
                    canvasValid = true;
                }
            }
        }
        if (img.width !== lastWidth || img.height !== lastHeight) {
            lastWidth = img.width;
            lastHeight = img.height;
            zoom = 1;
            offsetX = 0;
            offsetY = 0;
        }
        canvasStack.classList.add('visible');
        canvasPlaceholder.classList.add('hidden');
    } else {
        canvasStack.classList.remove('visible');
        canvasPlaceholder.classList.remove('hidden');
        canvasValid = false;
    }

    const backdrop = store.settings.canvasBackdrop;
    canvasStack.classList.toggle('backdrop-checker', backdrop === 'checker');
    canvasStack.classList.toggle('backdrop-black', backdrop === 'black');
    canvasStack.classList.toggle('backdrop-white', backdrop === 'white');

    applyCanvasLayout();
    redrawOverlay();
    // Also runs when there is no image (applyCanvasLayout returns early then),
    // so the minimap hides itself correctly.
    renderMinimap();
}

// --- Viewport event listeners ---

window.addEventListener('resize', () => applyCanvasLayout());

canvasArea.addEventListener(
    'wheel',
    (event) => {
        if (!store.current) {
            return;
        }
        if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            zoomAtPoint(event.clientX, event.clientY, event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
            return;
        }
        let dx = event.deltaX;
        let dy = event.deltaY;
        if (event.shiftKey && dx === 0) {
            dx = dy;
            dy = 0;
        }
        if (dx === 0 && dy === 0) {
            return;
        }
        offsetX -= dx;
        offsetY -= dy;
        applyCanvasLayout();
    },
    { passive: false },
);
