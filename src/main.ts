import './style.css';
import { store } from './appStore';
import {
    applyCanvasLayout,
    canvas,
    canvasArea,
    canvasPlaceholder,
    currentScale,
    hideResizePreview,
    hideSamplePreview,
    hitTolerance,
    markCanvasValid,
    panBy,
    redrawOverlay,
    refreshCanvas,
    sampleAt,
    sampleColorAt,
    setHoverPoint,
    showResizePreview,
    showSamplePreview,
    toImagePoint,
    zoomAtPoint,
} from './editor/canvasView';
import { clamp, colorToHex, distinctColors, hexToColor, rgb, RGB } from './shared/color';
import { AppContext } from './context';
import { h } from './shared/dom';
import { imageDataFromBlob, loadImageFile, saveImageFile } from './shared/files';
import { computeScale, cursorForHit, hitTestBox } from './core/floating';
import { decodeProject, isProjectFileName, projectBaseName } from './core/project';
import {
    AUTOSAVE_INTERVAL_MS,
    autoSaveRecent,
    beginNewSession,
    beginSession,
    readRecent,
    RecentEntry,
    removeRecent,
} from './core/recentFiles';
import {
    applyTransform,
    cancelFloating,
    commitFloating,
    currentBox,
    endTransformDrag,
    getTransformDrag,
    isFloating,
    moveToolLayers,
    startTransformDrag,
} from './editor/floatingSelection';
import { toolIcon } from './ui/icons';
import { countUniqueColors, offsetImage, resizeImage } from './shared/image';
import { compositeLayers, flattenVisibleLayers, Layer } from './core/layers';
import { applySymmetrizedFill, hitTestSymmetry, remapToPalette } from './core/modifiers';
import {
    continueStroke,
    endStroke,
    getCloneSource,
    getLastPaintPoint,
    hasActiveStroke,
    isBrushTool,
    setCloneSource,
    startBrushStroke,
    startCloneStroke,
    startHealStroke,
    startKnifeStroke,
} from './editor/paint';
import { medianCut } from './core/palette';
import { combineSelection, wandSelection } from './core/selection';
import {
    finishSelectionDrag,
    isSelecting,
    selectionModeFor,
    startSelectionDrag,
    updateSelectionDrag,
} from './editor/selectionDrag';
import { installShortcuts } from './shortcuts';
import { beginMeasure, clearMeasurement, endMeasure, isMeasuring, updateMeasure } from './editor/measure';
import { commitText, initTextTool, isTextEditing, startText } from './editor/textTool';
import { TOOLS, ToolId, floodFill } from './core/tools';
import { renameActiveLayerInPanel } from './ui/layersPanel';
import { createMiniLayers, MiniLayers } from './ui/miniLayers';
import { openNewFileDialog } from './ui/newFileDialog';
import { openFileDialog } from './ui/openFileDialog';
import { createOptionsBar } from './ui/optionsBar';
import { createPanels } from './ui/panels';
import { openSaveDialog } from './ui/saveDialog';
import { getActiveColorPicker, selectColorDialog } from './ui/selectColor';
import { createStartScreen } from './ui/startScreen';
import { createTimeline, Timeline } from './ui/timeline';
import { createToolbar } from './ui/toolbar';

let timeline: Timeline | null = null;
let miniLayers: MiniLayers | null = null;

async function copyText(text: string): Promise<void> {
    try {
        await navigator.clipboard.writeText(text);
    } catch {
        // Clipboard API unavailable (e.g. non-secure context); ignore.
    }
}

// --- Document lifecycle ---

// Generates a palette (median cut) from an image, using the default palette
// size from settings. Runs on a small downscaled sample so it stays fast for
// large images; images with fewer colors than the configured size produce a
// smaller palette. Median cut can average different groups to the same color,
// so duplicates are removed.
function generateAutoPalette(image: ImageData): void {
    const maxDim = 256;
    const scale = Math.min(1, maxDim / Math.max(image.width, image.height));
    const sample =
        scale < 1
            ? resizeImage(image, Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)))
            : image;
    const requested = Math.max(1, Math.round(store.settings.paletteSize));
    const unique = countUniqueColors(sample, requested);
    if (unique === 0) {
        return;
    }
    const colors = distinctColors(medianCut(sample, Math.min(requested, unique)));
    if (colors.length > 0) {
        store.palette = colors;
        store.emit();
    }
}

function openDocument(image: ImageData, refreshPalette = false): void {
    commitFloating();
    clearMeasurement();
    const hadDocument = store.current !== null;
    // The palette is finalized before the document opens so the store records
    // it as the document's initial palette (the Restore target).
    if (!hadDocument || refreshPalette) {
        generateAutoPalette(image);
    }
    store.openImage(image);
    // Opened/pasted images are new documents: a fresh recent-files session
    // (default name; it gains one when saved) so they never overwrite another
    // document's auto-save.
    beginNewSession();
}

const BASE_COLORS: RGB[] = [
    rgb(0, 0, 0),
    rgb(255, 255, 255),
    rgb(255, 0, 0),
    rgb(0, 255, 0),
    rgb(0, 0, 255),
    rgb(255, 255, 0),
    rgb(0, 255, 255),
    rgb(255, 0, 255),
];

function newDocument(width?: number, height?: number): void {
    if (store.working) {
        return;
    }
    commitFloating();
    clearMeasurement();
    const w = Math.max(1, width ?? store.settings.canvasWidth);
    const h = Math.max(1, height ?? store.settings.canvasHeight);
    const background = store.settings.blankNewImage ? null : hexToColor(store.settings.backgroundColor);
    // Like openDocument, set the palette before the document so it becomes the
    // document's initial palette (the Restore target).
    store.palette = BASE_COLORS.map((color) => ({ ...color }));
    store.newDocument(w, h, background);
    // New documents start with the default name (see openDocument).
    beginNewSession();
}

// Loads a project (a .pixelpalette file or a recent-files blob) into the
// store. `recentId` continues an existing auto-save entry when there is one.
async function loadProject(source: Blob, name: string, recentId?: string): Promise<void> {
    if (store.working) {
        return;
    }
    commitFloating();
    clearMeasurement();
    store.working = true;
    store.setStatus('Opening project');
    let message = '';
    try {
        const data = await decodeProject(source);
        if (!data) {
            message = 'Could not read the project file';
            return;
        }
        store.openDocumentData(data);
        beginSession(name, recentId);
        // A project with several frames is an animation; show the timeline.
        if (store.frameCount > 1 && !store.settings.animationMode) {
            store.updateSettings({ animationMode: true });
        }
    } finally {
        store.working = false;
        store.setStatus(message);
    }
}

// Restores a document kept by the recent-files auto-save.
async function loadRecentFile(entry: RecentEntry): Promise<void> {
    const blob = await readRecent(entry.id);
    if (!blob) {
        // The entry's payload is gone (e.g. cleared by the browser); drop the
        // dangling list entry.
        await removeRecent(entry.id);
        store.setStatus('Recent file could not be loaded');
        return;
    }
    await loadProject(blob, entry.name, entry.id);
}

// --- File actions (toolbar + start screen) ---

async function newFileAction(): Promise<void> {
    if (store.working) {
        return;
    }
    const choice = await openNewFileDialog(store);
    if (!choice) {
        return;
    }
    // The size entered in the dialog applies to this document only; the
    // default canvas size in Settings stays untouched. Animation mode follows
    // the dialog's choice (and can be changed later in Settings).
    store.updateSettings({ animationMode: choice.animationMode });
    if ('image' in choice) {
        // A new file always resets the palette; when it comes from an image,
        // derive it from that image like a first paste does.
        openDocument(choice.image, true);
        return;
    }
    newDocument(choice.width, choice.height);
}

// Opens a file chosen from disk (Open File dialog or drag and drop): project
// files restore the whole document, images open as a new document.
async function openLocalFile(file: File): Promise<void> {
    if (store.working) {
        return;
    }
    if (isProjectFileName(file.name)) {
        await loadProject(file, projectBaseName(file.name));
        return;
    }
    const image = await imageDataFromBlob(file);
    if (image) {
        openDocument(image, true);
    } else {
        store.setStatus('Could not read that file');
    }
}

async function openFileAction(): Promise<void> {
    if (store.working) {
        return;
    }
    const choice = await openFileDialog();
    if (!choice) {
        return;
    }
    if ('image' in choice) {
        openDocument(choice.image, true);
        return;
    }
    if ('recent' in choice) {
        await loadRecentFile(choice.recent);
        return;
    }
    await openLocalFile(choice.file);
}

function saveDocument(): void {
    if (store.current && !store.working) {
        timeline?.stopPlayback();
        if (isTextEditing()) {
            commitText();
        }
        commitFloating();
        openSaveDialog(store, timeline?.getFps() ?? 12);
    }
}

// --- Tool strip ---

function selectTool(tool: ToolId): void {
    if (isTextEditing()) {
        commitText();
    }
    if (isFloating() && tool !== 'move') {
        commitFloating();
    }
    if (store.symmetry.transformMode) {
        store.setSymmetry({ transformMode: false });
    }
    store.setActiveTool(tool);
}

const toolButtons = new Map<ToolId, HTMLButtonElement>();
const toolsColumn = h('div', { class: 'tools-column' });
for (const tool of TOOLS) {
    const btn = h('button', {
        class: 'btn tool-btn',
        title: `${tool.label} (${tool.shortcut})`,
        onclick: () => selectTool(tool.id),
    });
    btn.innerHTML = toolIcon(tool.id);
    toolButtons.set(tool.id, btn);
    toolsColumn.append(btn);
}

// --- Dock + app context ---

const dock = h('div', { class: 'dock hidden' });
const dockResizer = h('div', { class: 'dock-resizer' });

const ctx: AppContext = {
    store,
    dock,
    selectColor: (initial, onChange) => selectColorDialog(initial, onChange),
    applyImage: (img) => {
        commitFloating();
        store.changeMainImage(img);
    },
    applyPaletteToImage: async () => {
        const image = store.activeImage;
        if (!image || store.palette.length === 0 || store.working) {
            return;
        }
        const palette = store.palette.slice();
        const result = await ctx.runTask('Applying palette to image', () => remapToPalette(image, palette));
        ctx.applyImage(result);
    },
    runTask: async (status, task) => {
        commitFloating();
        store.working = true;
        store.setStatus(status);
        await new Promise((resolve) => setTimeout(resolve, 0));
        try {
            return task();
        } finally {
            store.working = false;
            store.setStatus('');
        }
    },
    openImageFile: () => loadImageFile(),
    saveImage: (img) => saveImageFile(img, 'image.png'),
    copyText,
};

// --- Panels, toolbar, options bar ---

// Refreshes the layout after opening/closing a docked panel.
function panelChanged(): void {
    applyCanvasLayout();
    miniLayers?.sync();
    panels.refreshButtons();
}

const panels = createPanels(ctx, panelChanged);

const toolbar = createToolbar({
    onNew: () => void newFileAction(),
    onOpen: () => void openFileAction(),
    onSave: () => saveDocument(),
    onUndo: () => {
        if (!store.working) {
            if (isFloating()) {
                cancelFloating();
            } else {
                store.undo();
            }
        }
    },
    onRedo: () => {
        if (!store.working && !isFloating()) {
            store.redo();
        }
    },
    onRestore: () => {
        if (!store.working) {
            commitFloating();
            store.restore();
        }
    },
});

const optionsBar = createOptionsBar(ctx);

miniLayers = createMiniLayers(store, () => panels.isOpen('layers'));
panels.sidebar.append(miniLayers.root);

// Start screen shown while no document is open: quick actions plus tiles for
// the auto-saved recent files.
const startScreen = createStartScreen({
    onNew: () => void newFileAction(),
    onOpen: () => void openFileAction(),
    onRecent: (entry) => void loadRecentFile(entry),
});
canvasPlaceholder.append(startScreen.root);

// --- App assembly ---

const main = h('div', { class: 'main' }, [toolsColumn, panels.sidebar, dock, dockResizer, canvasArea]);
const app = h('div', { class: 'app' }, [toolbar.element, optionsBar.element, main]);

document.querySelector('#app')!.append(app);

initTextTool({
    applyImage: (image) => ctx.applyImage(image),
    redraw: redrawOverlay,
});

// --- Symmetry guide drag (Modifiers panel transform mode) ---

let symmetryDrag: {
    mode: 'move' | 'rotate';
    startX: number;
    startY: number;
    startCx: number;
    startCy: number;
    startPointerAngle: number;
    startLineAngle: number;
} | null = null;

function snapAngle(angle: number): number {
    const step = Math.PI / 12;
    return Math.round(angle / step) * step;
}

function beginSymmetryDrag(x: number, y: number): void {
    const sym = store.symmetry;
    const hit = hitTestSymmetry(sym, x, y, hitTolerance());
    if (!hit) {
        return;
    }
    symmetryDrag = {
        mode: hit === 'move' ? 'move' : 'rotate',
        startX: x,
        startY: y,
        startCx: sym.cx,
        startCy: sym.cy,
        startPointerAngle: Math.atan2(y - sym.cy, x - sym.cx),
        startLineAngle: sym.angle,
    };
}

function applySymmetryDrag(x: number, y: number, shiftKey: boolean): void {
    if (!symmetryDrag) {
        return;
    }
    const sym = store.symmetry;
    if (symmetryDrag.mode === 'move') {
        sym.cx = symmetryDrag.startCx + (x - symmetryDrag.startX);
        sym.cy = symmetryDrag.startCy + (y - symmetryDrag.startY);
        return;
    }
    const pointerAngle = Math.atan2(y - sym.cy, x - sym.cx);
    const angle = symmetryDrag.startLineAngle + (pointerAngle - symmetryDrag.startPointerAngle);
    sym.angle = shiftKey ? snapAngle(angle) : angle;
}

// --- Pointer interaction state ---

let panning = false;
let panMoved = false;
let panLastX = 0;
let panLastY = 0;
let spaceHeld = false;

let moving: {
    startClientX: number;
    startClientY: number;
    dx: number;
    dy: number;
    layers: { id: number; offsetX: number; offsetY: number }[];
} | null = null;
let sampling = false;

// Pre-rendered canvases used to preview a plain layer move without
// recompositing the whole document on every pointer event (which makes large
// images choppy). The real composite is rebuilt once when the drag ends.
let movePreview: {
    below: HTMLCanvasElement | null;
    above: HTMLCanvasElement | null;
    layer: HTMLCanvasElement;
} | null = null;

function imageToCanvas(image: ImageData): HTMLCanvasElement {
    const element = document.createElement('canvas');
    element.width = image.width;
    element.height = image.height;
    element.getContext('2d')!.putImageData(image, 0, 0);
    return element;
}

function layersToCanvas(layers: Layer[]): HTMLCanvasElement | null {
    if (!layers.some((layer) => layer.visible && layer.opacity > 0)) {
        return null;
    }
    return imageToCanvas(compositeLayers(layers, store.width, store.height));
}

function buildMovePreview(layers: Layer[]): void {
    if (layers.length === 0) {
        movePreview = null;
        return;
    }
    // Split the visible layers into those below and above the dragged ones, so
    // the preview can draw the moving layers at their dragged position in
    // between. Layers sandwiched between moving ones show as part of the group
    // for the duration of the drag.
    const visible = flattenVisibleLayers(store.nodes);
    const ids = new Set(layers.map((layer) => layer.id));
    let first = -1;
    let last = -1;
    visible.forEach((layer, index) => {
        if (ids.has(layer.id)) {
            if (first < 0) {
                first = index;
            }
            last = index;
        }
    });
    const below = first >= 0 ? visible.slice(0, first) : visible;
    const above = last >= 0 ? visible.slice(last + 1) : [];
    movePreview = {
        below: layersToCanvas(below),
        above: layersToCanvas(above),
        layer: imageToCanvas(compositeLayers(layers, store.width, store.height)),
    };
}

function drawMovePreview(): void {
    const context = canvas.getContext('2d');
    if (!movePreview || !moving || !context) {
        return;
    }
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (movePreview.below) {
        context.drawImage(movePreview.below, 0, 0);
    }
    context.drawImage(movePreview.layer, moving.dx, moving.dy);
    if (movePreview.above) {
        context.drawImage(movePreview.above, 0, 0);
    }
    markCanvasValid();
}

let resizeDrag: {
    handle: string;
    startWidth: number;
    startHeight: number;
    startBox: { cx: number; cy: number; w: number; h: number };
} | null = null;
let resizePending: { width: number; height: number; left: number; top: number } | null = null;

function beginPan(event: PointerEvent): void {
    panning = true;
    panMoved = false;
    panLastX = event.clientX;
    panLastY = event.clientY;
    canvas.style.cursor = 'grabbing';
}

function beginMoveInteraction(event: PointerEvent, pointX: number, pointY: number): void {
    // Plain layer drag: offsets the moving layers (with a cheap preview) and
    // bakes the offsets when the drag ends. With several layers selected they
    // all move together.
    const targets = moveToolLayers();
    const startLayerDrag = (): void => {
        if (targets.length === 0) {
            return;
        }
        store.pushHistory();
        buildMovePreview(targets);
        moving = {
            startClientX: event.clientX,
            startClientY: event.clientY,
            dx: 0,
            dy: 0,
            layers: targets.map((layer) => ({ id: layer.id, offsetX: layer.offsetX, offsetY: layer.offsetY })),
        };
    };

    const box = currentBox();
    if (!box) {
        startLayerDrag();
        return;
    }
    const hit = hitTestBox(box, pointX, pointY, hitTolerance());
    if (hit === 'inside' && !isFloating() && !store.selection) {
        // No selection: the box frames the layer, so grabbing its inside moves
        // the layer as before.
        startLayerDrag();
        return;
    }
    if (hit === null) {
        if (isFloating()) {
            commitFloating();
        } else if (!store.selection) {
            // Without a selection, dragging outside the box still moves the
            // layer (kept from the original behaviour).
            startLayerDrag();
        }
        return;
    }
    // Handles (and rotate zones) lift the selection, or the whole layer when
    // there is no selection, into a floating transform.
    startTransformDrag(hit, pointX, pointY, event.altKey);
}

function bakeLayerOffsets(ids: number[]): void {
    let changed = false;
    for (const id of ids) {
        const layer = store.layers.find((item) => item.id === id);
        if (!layer || (layer.offsetX === 0 && layer.offsetY === 0)) {
            continue;
        }
        const baked = offsetImage(layer.image, layer.offsetX, layer.offsetY);
        store.replaceLayer({ ...layer, image: baked, offsetX: 0, offsetY: 0 });
        changed = true;
    }
    if (changed) {
        store.notify();
    }
}

// Raw pen/touch pressure (0..1). A reported 0 is a real value (tablets often
// report it for the first events of a stroke) and is passed through unchanged:
// the paint layer waits for a nonzero reading before laying down the first
// stamp rather than treating 0 as full pressure (which paints an oversized blob
// at the stroke start). Mouse and other pointers paint at full pressure.
function pointerPressure(event: PointerEvent): number {
    if (event.pointerType === 'pen' || event.pointerType === 'touch') {
        return clamp(event.pressure, 0, 1);
    }
    return 1;
}

function updateHoverCursor(x: number, y: number): void {
    const tool = store.activeTool;
    if (store.symmetry.transformMode) {
        const hit = hitTestSymmetry(store.symmetry, x, y, hitTolerance());
        canvas.style.cursor = hit === 'move' ? 'move' : hit ? 'grab' : '';
        return;
    }
    if (tool === 'text') {
        canvas.style.cursor = 'text';
        return;
    }
    if (tool === 'measure') {
        canvas.style.cursor = 'crosshair';
        return;
    }
    if (tool !== 'move' && tool !== 'resize') {
        canvas.style.cursor = '';
        return;
    }
    const box = currentBox();
    if (!box) {
        canvas.style.cursor = '';
        return;
    }
    const hit = hitTestBox(box, x, y, hitTolerance());
    if (tool === 'resize' && (hit === 'inside' || hit === 'rotate')) {
        canvas.style.cursor = '';
        return;
    }
    canvas.style.cursor = cursorForHit(hit) ?? '';
}

// --- Canvas pointer handlers ---

canvas.addEventListener('pointerdown', (event) => {
    const img = store.current;
    if (!img || store.playing) {
        return;
    }
    canvas.setPointerCapture(event.pointerId);
    hideSamplePreview();
    const point = toImagePoint(event.clientX, event.clientY);
    const tool = store.activeTool;

    const picker = getActiveColorPicker();
    if (picker) {
        sampling = true;
        sampleAt(img, point.x, point.y, event.clientX, event.clientY);
        return;
    }

    if (event.button === 1 || spaceHeld) {
        beginPan(event);
        return;
    }
    if (event.button !== 0) {
        return;
    }

    // The Modifiers panel's transform mode turns canvas drags into guide edits.
    if (store.symmetry.transformMode) {
        beginSymmetryDrag(point.x, point.y);
        return;
    }
    if (tool === 'hand') {
        beginPan(event);
        return;
    }

    // Alt+click with the brush or paint bucket acts as an eyedropper.
    if (event.altKey && (tool === 'brush' || tool === 'bucket')) {
        sampling = true;
        sampleAt(img, point.x, point.y, event.clientX, event.clientY);
        return;
    }

    switch (tool) {
        case 'zoom':
            zoomAtPoint(event.clientX, event.clientY, event.altKey ? 1 / 1.5 : 1.5);
            break;
        case 'eyedropper':
            sampling = true;
            sampleAt(img, point.x, point.y, event.clientX, event.clientY);
            break;
        case 'brush':
        case 'eraser': {
            const image = store.beginPaint();
            if (!image) {
                break;
            }
            const pressure = pointerPressure(event);
            const kind = tool === 'eraser' ? 'eraser' : 'brush';
            const last = getLastPaintPoint();
            if (event.shiftKey && last) {
                // Shift+click: straight line from the previous stroke's end to
                // the clicked point (a single, finished stroke).
                startBrushStroke(kind, image, last.x, last.y, pressure);
                continueStroke(point.x, point.y, pressure);
                endStroke();
                break;
            }
            startBrushStroke(kind, image, point.x, point.y, pressure);
            break;
        }
        case 'clone': {
            if (event.altKey) {
                setCloneSource({ x: point.x, y: point.y });
                redrawOverlay();
                break;
            }
            const before = store.activeLayer;
            if (!before || !getCloneSource()) {
                break;
            }
            const source = before.image;
            const image = store.beginPaint();
            if (!image) {
                break;
            }
            startCloneStroke(source, image, point.x, point.y, pointerPressure(event));
            break;
        }
        case 'heal': {
            const before = store.activeLayer;
            if (!before) {
                break;
            }
            const source = before.image;
            const image = store.beginPaint();
            if (!image) {
                break;
            }
            startHealStroke(source, image, point.x, point.y, pointerPressure(event));
            break;
        }
        case 'knife': {
            const image = store.beginPaint();
            if (!image) {
                break;
            }
            startKnifeStroke(image, point.x, point.y, pointerPressure(event));
            break;
        }
        case 'bucket': {
            const image = store.beginPaint();
            const layer = store.activeLayer;
            if (!image || !layer) {
                break;
            }
            const fill = floodFill(image, point.x, point.y, {
                color: store.paintColor,
                // Palette lock fills opaquely so no blending can leave
                // off-palette or semi-transparent pixels.
                alpha: store.paletteLock.enabled && store.palette.length > 0 ? 1 : store.brushOpacity,
                tolerance: store.fillTolerance,
                selection: store.selection,
                offsetX: layer.offsetX,
                offsetY: layer.offsetY,
            });
            if (fill) {
                let minX = fill.x;
                let minY = fill.y;
                let maxX = fill.x + fill.width;
                let maxY = fill.y + fill.height;
                if (store.symmetry.enabled) {
                    const mirrored = applySymmetrizedFill(
                        image,
                        fill.mask,
                        { x: fill.x - layer.offsetX, y: fill.y - layer.offsetY, width: fill.width, height: fill.height },
                        store.symmetry,
                        layer.offsetX,
                        layer.offsetY,
                    );
                    if (mirrored) {
                        minX = Math.min(minX, mirrored.x);
                        minY = Math.min(minY, mirrored.y);
                        maxX = Math.max(maxX, mirrored.x + mirrored.width);
                        maxY = Math.max(maxY, mirrored.y + mirrored.height);
                    }
                }
                // Only the filled (and mirrored) region is re-composited and repainted.
                store.notifyArea(minX, minY, maxX - minX, maxY - minY);
            } else {
                store.emit();
            }
            break;
        }
        case 'marquee':
            startSelectionDrag('marquee', point, event.clientX, event.clientY, selectionModeFor(event));
            break;
        case 'lasso':
            startSelectionDrag('lasso', point, event.clientX, event.clientY, selectionModeFor(event));
            break;
        case 'wand': {
            const mask = wandSelection(img, Math.floor(point.x), Math.floor(point.y), store.wandTolerance);
            store.setSelection(combineSelection(store.selection, mask, selectionModeFor(event)));
            break;
        }
        case 'move':
            beginMoveInteraction(event, point.x, point.y);
            break;
        case 'text': {
            startText(point.x, point.y);
            canvas.style.cursor = 'text';
            break;
        }
        case 'measure': {
            beginMeasure(clamp(point.x, 0, store.width), clamp(point.y, 0, store.height));
            redrawOverlay();
            break;
        }
        case 'resize': {
            const box = currentBox();
            if (box) {
                const hit = hitTestBox(box, point.x, point.y, hitTolerance());
                if (hit && hit !== 'inside' && hit !== 'rotate') {
                    resizeDrag = {
                        handle: hit,
                        startWidth: store.width,
                        startHeight: store.height,
                        startBox: { cx: box.cx, cy: box.cy, w: box.w, h: box.h },
                    };
                }
            }
            break;
        }
    }
});

canvas.addEventListener('pointermove', (event) => {
    const img = store.current;
    if (!img || store.playing) {
        return;
    }
    const point = toImagePoint(event.clientX, event.clientY);

    if (symmetryDrag) {
        applySymmetryDrag(point.x, point.y, event.shiftKey);
        canvas.style.cursor = 'grabbing';
        redrawOverlay();
        return;
    }

    if (isBrushTool(store.activeTool)) {
        setHoverPoint({ x: point.x, y: point.y });
        // During a stroke the overlay is refreshed once per animation frame by the
        // paint update; redrawing it per pointer event would just do the same work
        // many times per shown frame.
        if (!hasActiveStroke()) {
            redrawOverlay();
        }
    }

    if (panning) {
        panBy(event.clientX - panLastX, event.clientY - panLastY);
        panLastX = event.clientX;
        panLastY = event.clientY;
        if (Math.abs(event.movementX) + Math.abs(event.movementY) > 0) {
            panMoved = true;
        }
        applyCanvasLayout();
        return;
    }

    if (sampling) {
        sampleAt(img, point.x, point.y, event.clientX, event.clientY);
        return;
    }

    if (isMeasuring()) {
        updateMeasure(clamp(point.x, 0, store.width), clamp(point.y, 0, store.height), event.shiftKey);
        redrawOverlay();
        return;
    }

    if (hasActiveStroke()) {
        const pressure = pointerPressure(event);
        continueStroke(point.x, point.y, pressure, event.shiftKey);
        return;
    }

    if (isSelecting()) {
        updateSelectionDrag(point, event.clientX, event.clientY);
        // Only the outline is drawn while dragging; the mask is built on release.
        redrawOverlay();
        return;
    }

    const transform = getTransformDrag();
    if (transform && isFloating()) {
        applyTransform(point.x, point.y, event.shiftKey, event.altKey);
        redrawOverlay();
        canvas.style.cursor = transform.mode === 'move' ? 'grabbing' : cursorForHit(transform.handle) ?? '';
        return;
    }

    if (resizeDrag) {
        const scaled = computeScale(
            {
                cx: resizeDrag.startBox.cx,
                cy: resizeDrag.startBox.cy,
                scaleX: 1,
                scaleY: 1,
                rotation: 0,
                originW: resizeDrag.startWidth,
                originH: resizeDrag.startHeight,
            },
            resizeDrag.handle,
            point.x,
            point.y,
            event.shiftKey,
        );
        const width = Math.max(1, Math.round(resizeDrag.startWidth * scaled.scaleX));
        const height = Math.max(1, Math.round(resizeDrag.startHeight * scaled.scaleY));
        const left = Math.round(scaled.cx - width / 2);
        const top = Math.round(scaled.cy - height / 2);
        resizePending = { width, height, left, top };
        if (document.activeElement !== optionsBar.resizeWidthInput) {
            optionsBar.resizeWidthInput.value = String(width);
        }
        if (document.activeElement !== optionsBar.resizeHeightInput) {
            optionsBar.resizeHeightInput.value = String(height);
        }
        showResizePreview(left, top, width, height);
        return;
    }

    if (moving) {
        const scale = currentScale(img) || 1;
        const dx = Math.round((event.clientX - moving.startClientX) / scale);
        const dy = Math.round((event.clientY - moving.startClientY) / scale);
        if (dx !== moving.dx || dy !== moving.dy) {
            moving.dx = dx;
            moving.dy = dy;
            for (const entry of moving.layers) {
                const layer = store.layers.find((item) => item.id === entry.id);
                if (layer) {
                    store.replaceLayer({ ...layer, offsetX: entry.offsetX + dx, offsetY: entry.offsetY + dy });
                }
            }
            drawMovePreview();
            redrawOverlay();
        }
        return;
    }

    // The eyedropper (and Alt+brush/bucket) previews the color under the
    // cursor while hovering. With a color picker open the canvas samples into
    // it, so show the same preview there.
    if (
        getActiveColorPicker() !== null ||
        store.activeTool === 'eyedropper' ||
        ((store.activeTool === 'brush' || store.activeTool === 'bucket') && event.altKey)
    ) {
        showSamplePreview(event.clientX, event.clientY, sampleColorAt(img, point.x, point.y));
    } else {
        hideSamplePreview();
    }
    updateHoverCursor(point.x, point.y);
});

canvas.addEventListener('pointerleave', () => {
    setHoverPoint(null);
    hideSamplePreview();
    canvas.style.cursor = '';
    redrawOverlay();
});

function endPointer(event: PointerEvent): void {
    if (store.playing) {
        return;
    }
    if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
    }
    canvas.style.cursor = '';

    if (panning) {
        const img = store.current;
        if (!panMoved && store.activeTool === 'hand' && img) {
            const point = toImagePoint(event.clientX, event.clientY);
            void copyText(colorToHex(sampleColorAt(img, point.x, point.y)));
        }
        panning = false;
    }
    if (hasActiveStroke()) {
        endStroke();
    }
    if (isMeasuring()) {
        // Use the release position for the final measurement, then keep it on
        // screen until the next drag (or Escape).
        const point = toImagePoint(event.clientX, event.clientY);
        updateMeasure(clamp(point.x, 0, store.width), clamp(point.y, 0, store.height), event.shiftKey);
        endMeasure();
        redrawOverlay();
    }
    if (isSelecting()) {
        finishSelectionDrag();
    }
    if (moving) {
        const ids = moving.layers.map((entry) => entry.id);
        moving = null;
        movePreview = null;
        bakeLayerOffsets(ids);
    }
    sampling = false;
    hideSamplePreview();
    endTransformDrag();
    if (symmetryDrag) {
        symmetryDrag = null;
        // Sync the panel inputs after editing the guide directly on the image.
        store.emit();
    }

    if (resizeDrag) {
        const pending = resizePending;
        resizeDrag = null;
        resizePending = null;
        hideResizePreview();
        if (
            pending &&
            (pending.width !== store.width ||
                pending.height !== store.height ||
                pending.left !== 0 ||
                pending.top !== 0)
        ) {
            if (optionsBar.resizeScaleCheckbox.checked) {
                store.resizeDocument(pending.width, pending.height);
            } else {
                store.resizeCanvas(pending.width, pending.height, pending.left, pending.top);
            }
        }
    }
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

// --- Clipboard paste (as a new layer) ---

window.addEventListener('paste', (event) => {
    if (store.working) {
        return;
    }
    const items = event.clipboardData?.items;
    if (!items) {
        return;
    }
    let file: File | null = null;
    for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
            file = items[i].getAsFile();
            if (file) {
                break;
            }
        }
    }
    if (!file) {
        return;
    }
    event.preventDefault();
    void imageDataFromBlob(file).then((image) => {
        if (!image) {
            return;
        }
        if (store.current) {
            commitFloating();
            store.addImageLayer(image);
        } else {
            openDocument(image);
        }
    });
});

// --- Layer focus (Delete removes the focused layer) ---

// Clicking a layer row focuses it; any click outside the layer lists clears
// that focus, so Delete falls back to deleting the selection. Timeline frames
// work the same way for the frame-focus Delete.
window.addEventListener(
    'pointerdown',
    (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target?.closest('.mini-layer-list, .layer-list')) {
            store.setLayerFocus(false);
        }
        if (!target?.closest('.frame-strip')) {
            store.setFrameFocus(false);
        }
    },
    true,
);

// --- Keyboard shortcuts ---

installShortcuts({
    saveDocument,
    selectTool,
    getTimeline: () => timeline,
    clearSymmetryDrag: () => {
        symmetryDrag = null;
        store.setSymmetry({ transformMode: false });
    },
    setSpaceHeld: (held) => {
        spaceHeld = held;
    },
    renameLayer: () => {
        // Rename in the docked Layers panel when it is open, otherwise in the
        // sidebar's compact list (the only one visible then).
        if (!renameActiveLayerInPanel()) {
            miniLayers?.renameActive();
        }
    },
});

// --- Dock resizing ---

const DOCK_MIN_WIDTH = 240;
let resizingDock = false;
let resizeStartX = 0;
let resizeStartWidth = 0;

dockResizer.addEventListener('pointerdown', (event) => {
    resizingDock = true;
    resizeStartX = event.clientX;
    resizeStartWidth = dock.getBoundingClientRect().width;
    dock.style.maxWidth = 'none';
    dockResizer.setPointerCapture(event.pointerId);
    document.body.style.cursor = 'col-resize';
    event.preventDefault();
});

dockResizer.addEventListener('pointermove', (event) => {
    if (!resizingDock) {
        return;
    }
    const width = clamp(resizeStartWidth + (event.clientX - resizeStartX), DOCK_MIN_WIDTH, window.innerWidth * 0.8);
    dock.style.width = `${width}px`;
    applyCanvasLayout();
});

const endDockResize = (event: PointerEvent): void => {
    if (!resizingDock) {
        return;
    }
    resizingDock = false;
    dockResizer.releasePointerCapture(event.pointerId);
    document.body.style.cursor = '';
    applyCanvasLayout();
};

dockResizer.addEventListener('pointerup', endDockResize);
dockResizer.addEventListener('pointercancel', endDockResize);

// --- Rendering / state sync ---

function render(): void {
    refreshCanvas();
    toolbar.refresh();
    optionsBar.refresh();
    panels.refreshButtons();
    panels.refreshDisabled(store.working);

    for (const [id, btn] of toolButtons) {
        btn.classList.toggle('active', id === store.activeTool);
    }

    miniLayers?.sync();
    timeline?.sync();
    // Keep the start screen's recent tiles current while no document is open.
    if (store.current === null) {
        startScreen.refresh();
    }
}

function prepareFrameChange(): void {
    if (isTextEditing()) {
        commitText();
    }
    if (isFloating()) {
        commitFloating();
    }
}

timeline = createTimeline(ctx, applyCanvasLayout, prepareFrameChange);
app.append(timeline.root);

store.onChange(render);
render();

// --- Recent files (auto-saved to IndexedDB) ---

// Periodic snapshot of the working document. visibilitychange/pagehide add
// best-effort saves around the moment the site is closed or hidden (the
// periodic one remains the reliable path; IndexedDB writes are asynchronous).
window.setInterval(() => {
    void autoSaveRecent(store);
}, AUTOSAVE_INTERVAL_MS);

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
        void autoSaveRecent(store);
    }
});

window.addEventListener('pagehide', () => {
    void autoSaveRecent(store);
});

// --- Drag and drop (onto the start screen) ---

// Always stop the browser from navigating to a dropped file; with no document
// open and no dialog in the way, the dropped file is opened instead.
window.addEventListener('dragover', (event) => {
    event.preventDefault();
});

window.addEventListener('drop', (event) => {
    event.preventDefault();
    if (store.current !== null || document.querySelector('.overlay')) {
        return;
    }
    const file = event.dataTransfer?.files?.[0];
    if (file) {
        void openLocalFile(file);
    }
});
