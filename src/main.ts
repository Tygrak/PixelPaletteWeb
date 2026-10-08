import './style.css';
import { clamp, colorToHex, rgb, RGB } from './color';
import { AppContext } from './context';
import { DockPanel, h } from './dom';
import { imageDataFromBlob, loadImageFile, saveImageFile } from './files';
import {
  bakeFloating,
  Box,
  BoxHit,
  boxCorners,
  boxFromBounds,
  boxFromFloating,
  compositeOverLayer,
  computeScale,
  cursorForHit,
  drawBoxToContext,
  drawFloatingToContext,
  Floating,
  hitTestBox,
  liftSelection,
  selectionBounds,
} from './floating';
import { toolIcon } from './icons';
import { createEmptyImage, getPixel, resizeImage } from './image';
import { medianCut } from './palette';
import { polygonSelection, rectSelection, selectionOverlay, Selection, wandSelection } from './selection';
import { Store } from './store';
import { floodFill, paintStroke, stampBrush, ToolId, toolForShortcut, TOOLS } from './tools';
import { openAdjustmentsPanel } from './ui/adjustmentsPanel';
import { openDitherPanel } from './ui/ditherPanel';
import { openEffectsPanel } from './ui/effectsPanel';
import { openLayersPanel } from './ui/layersPanel';
import { openPalettePanel } from './ui/palettePanel';
import { getActiveColorPicker, selectColorDialog } from './ui/selectColor';

const store = new Store();

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard API unavailable (e.g. non-secure context); ignore.
  }
}

// --- Floating selection state ---

let floating: Floating | null = null;
let transformDrag: {
  mode: 'move' | 'scale' | 'rotate';
  handle: string;
  startX: number;
  startY: number;
  startCx: number;
  startCy: number;
  startScaleX: number;
  startScaleY: number;
  startAngle: number;
  startRotation: number;
} | null = null;

let cachedBoundsMask: Selection | null = null;
let cachedBounds: ReturnType<typeof selectionBounds> = null;

function selectionBoundsCached(): ReturnType<typeof selectionBounds> {
  if (cachedBoundsMask === store.selection) {
    return cachedBounds;
  }
  cachedBoundsMask = store.selection;
  cachedBounds = store.selection ? selectionBounds(store.selection, store.width, store.height) : null;
  return cachedBounds;
}

function currentBox(): Box | null {
  if (floating) {
    return boxFromFloating(floating);
  }
  if (store.activeTool === 'move') {
    const bounds = selectionBoundsCached();
    if (bounds) {
      return boxFromBounds(bounds);
    }
  }
  return null;
}

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
  store.layers[store.activeIndex] = { ...layer, image: result.cleared };
  floating = result.floating;
  store.notify();
  return true;
}

// Copies the selected pixels (or the floating selection) to the clipboard as a
// PNG. Returns false if there is nothing selected or the clipboard API is
// unavailable.
async function copySelectionToClipboard(): Promise<boolean> {
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

function commitFloating(): void {
  if (!floating) {
    return;
  }
  const layer = store.activeLayer;
  if (layer) {
    const baked = bakeFloating(floating, store.width, store.height);
    const target = createEmptyImage(store.width, store.height);
    target.data.set(layer.image.data);
    compositeOverLayer(target, baked, layer.offsetX, layer.offsetY);
    store.layers[store.activeIndex] = { ...layer, image: target };
  }
  floating = null;
  store.clearSelection();
  store.notify();
}

function cancelFloating(): void {
  if (!floating) {
    return;
  }
  floating = null;
  store.clearSelection();
  store.undo();
}

// --- Layout ---

const canvas = h('canvas', { class: 'main-canvas' });
const overlayCanvas = h('canvas', { class: 'overlay-canvas' });
const canvasStack = h('div', { class: 'canvas-stack' }, [canvas, overlayCanvas]);
const canvasPlaceholder = h('div', {
  class: 'placeholder',
  text: 'Open an image to begin, or press Ctrl+V to paste one',
});
const canvasArea = h('div', { class: 'canvas-area' }, [canvasStack, canvasPlaceholder]);
const dock = h('div', { class: 'dock hidden' });
const dockResizer = h('div', { class: 'dock-resizer' });

const imageSizeText = h('span', { class: 'image-size' });
const statusText = h('span', { class: 'status' });

const ctx: AppContext = {
  store,
  dock,
  selectColor: (initial) => selectColorDialog(initial),
  applyImage: (img) => {
    commitFloating();
    store.changeMainImage(img);
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

// --- Docked panels (toggled from the sidebar) ---

let palettePanel: DockPanel | null = null;
let ditherPanel: DockPanel | null = null;
let adjustmentsPanel: DockPanel | null = null;
let effectsPanel: DockPanel | null = null;
let layersPanel: DockPanel | null = null;

const togglePanels: Record<string, () => void> = {
  palette: () => {
    if (palettePanel) {
      palettePanel.close();
      return;
    }
    palettePanel = openPalettePanel(ctx, () => {
      palettePanel = null;
      applyCanvasLayout();
    });
    applyCanvasLayout();
  },
  dither: () => {
    if (ditherPanel) {
      ditherPanel.close();
      return;
    }
    ditherPanel = openDitherPanel(ctx, () => {
      ditherPanel = null;
      applyCanvasLayout();
    });
    applyCanvasLayout();
  },
  adjustments: () => {
    if (adjustmentsPanel) {
      adjustmentsPanel.close();
      return;
    }
    adjustmentsPanel = openAdjustmentsPanel(ctx, () => {
      adjustmentsPanel = null;
      applyCanvasLayout();
    });
    applyCanvasLayout();
  },
  effects: () => {
    if (effectsPanel) {
      effectsPanel.close();
      return;
    }
    effectsPanel = openEffectsPanel(ctx, () => {
      effectsPanel = null;
      applyCanvasLayout();
    });
    applyCanvasLayout();
  },
  layers: () => {
    if (layersPanel) {
      layersPanel.close();
      return;
    }
    layersPanel = openLayersPanel(ctx, () => {
      layersPanel = null;
      applyCanvasLayout();
    });
    applyCanvasLayout();
  },
};

// --- Toolbar ---

// Generates an 8-color palette (median cut) from an image. Runs on a small
// downscaled sample so it stays fast for large images.
function generateAutoPalette(image: ImageData): void {
  const maxDim = 256;
  const scale = Math.min(1, maxDim / Math.max(image.width, image.height));
  const sample =
    scale < 1
      ? resizeImage(image, Math.max(1, Math.round(image.width * scale)), Math.max(1, Math.round(image.height * scale)))
      : image;
  const colors = medianCut(sample, 8);
  if (colors.length > 0) {
    store.palette = colors;
    store.emit();
  }
}

function openDocument(image: ImageData): void {
  commitFloating();
  const hadDocument = store.current !== null;
  store.openImage(image);
  if (!hadDocument) {
    generateAutoPalette(image);
  }
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

function newDocument(): void {
  if (store.working) {
    return;
  }
  commitFloating();
  const image = createEmptyImage(1024, 1024);
  image.data.fill(255);
  store.openImage(image);
  store.palette = BASE_COLORS.map((color) => ({ ...color }));
  store.emit();
}

const newButton = h('button', {
  class: 'btn toolbar-btn',
  text: 'New File',
  onclick: () => newDocument(),
});
const openButton = h('button', {
  class: 'btn toolbar-btn',
  text: 'Open File',
  onclick: async () => {
    if (store.working) {
      return;
    }
    const image = await loadImageFile();
    if (image) {
      openDocument(image);
    }
  },
});
const saveButton = h('button', {
  class: 'btn toolbar-btn',
  text: 'Save File',
  onclick: () => {
    commitFloating();
    if (store.current && !store.working) {
      saveImageFile(store.current, 'image.png');
    }
  },
});
const undoButton = h('button', {
  class: 'btn toolbar-btn',
  text: 'Undo',
  onclick: () => {
    if (!store.working) {
      if (floating) {
        cancelFloating();
      } else {
        store.undo();
      }
    }
  },
});
const redoButton = h('button', {
  class: 'btn toolbar-btn',
  text: 'Redo',
  onclick: () => {
    if (!store.working && !floating) {
      store.redo();
    }
  },
});

const toolbar = h('div', { class: 'toolbar' }, [
  newButton,
  openButton,
  saveButton,
  undoButton,
  redoButton,
  h('div', { class: 'spacer' }),
  imageSizeText,
  statusText,
]);

// --- Tool strip ---

function selectTool(tool: ToolId): void {
  if (floating && tool !== 'move') {
    commitFloating();
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

// --- Sidebar (docked panels) ---

const restoreButton = h('button', {
  class: 'btn',
  text: 'Restore',
  onclick: () => {
    if (!store.working) {
      commitFloating();
      store.restore();
    }
  },
});
const ditherButton = h('button', { class: 'btn sidebar-btn', text: 'Dither', onclick: () => togglePanels.dither() });
const paletteButton = h('button', { class: 'btn sidebar-btn', text: 'Palette', onclick: () => togglePanels.palette() });
const adjustmentsButton = h('button', {
  class: 'btn sidebar-btn',
  text: 'Adjustments',
  onclick: () => togglePanels.adjustments(),
});
const effectsButton = h('button', { class: 'btn sidebar-btn', text: 'Effects', onclick: () => togglePanels.effects() });
const layersButton = h('button', { class: 'btn sidebar-btn', text: 'Layers', onclick: () => togglePanels.layers() });

const sidebar = h('div', { class: 'sidebar' }, [
  restoreButton,
  ditherButton,
  paletteButton,
  adjustmentsButton,
  effectsButton,
  layersButton,
]);

// --- Options bar ---

function numberInput(value: number, min: number, max: number, step: number, onInput: () => void): HTMLInputElement {
  const input = h('input', { type: 'number', value: String(value) });
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.style.width = '80px';
  input.addEventListener('input', onInput);
  return input;
}

function readNumber(input: HTMLInputElement): number {
  const value = parseFloat(input.value);
  return Number.isNaN(value) ? 0 : value;
}

const brushSizeInput = numberInput(store.brushSize, 1, 500, 1, () => store.setBrushSize(readNumber(brushSizeInput)));
const brushOpacityInput = numberInput(Math.round(store.brushOpacity * 100), 0, 100, 1, () =>
  store.setBrushOpacity(clamp(readNumber(brushOpacityInput) / 100, 0, 1)),
);
const brushSwatch = h('span', { class: 'palette-swatch small' });
const pickForegroundButton = h('button', {
  class: 'btn',
  text: 'Color',
  onclick: async () => {
    const chosen = await ctx.selectColor(store.foreground);
    store.setForeground(chosen);
  },
});
const softBrushCheckbox = document.createElement('input');
softBrushCheckbox.type = 'checkbox';
softBrushCheckbox.checked = store.softBrush;
softBrushCheckbox.addEventListener('change', () => store.setSoftBrush(softBrushCheckbox.checked));
const brushSection = h('div', { class: 'options-section' }, [
  h('span', { class: 'row-label', text: 'Size' }),
  brushSizeInput,
  h('span', { class: 'row-label', text: 'Opacity' }),
  brushOpacityInput,
  h('span', { class: 'row-label', text: 'Soft' }),
  softBrushCheckbox,
  h('span', { class: 'row-label', text: 'Color' }),
  brushSwatch,
  pickForegroundButton,
]);

const wandToleranceInput = numberInput(store.wandTolerance, 0, 255, 1, () =>
  store.setWandTolerance(readNumber(wandToleranceInput)),
);
const wandSection = h('div', { class: 'options-section' }, [
  h('span', { class: 'row-label', text: 'Tolerance' }),
  wandToleranceInput,
]);

const fillToleranceInput = numberInput(store.fillTolerance, 0, 255, 1, () =>
  store.setFillTolerance(readNumber(fillToleranceInput)),
);
const bucketSection = h('div', { class: 'options-section' }, [
  h('span', { class: 'row-label', text: 'Tolerance' }),
  fillToleranceInput,
]);

const paletteStrip = h('div', { class: 'palette-strip' });
let lastPaletteSignature = '';
function renderPaletteStrip(): void {
  const signature = store.palette.map((color) => colorToHex(color)).join(',') + `|${colorToHex(store.foreground)}`;
  if (signature === lastPaletteSignature) {
    return;
  }
  lastPaletteSignature = signature;
  const foregroundHex = colorToHex(store.foreground);
  paletteStrip.replaceChildren();
  for (const color of store.palette) {
    const hex = colorToHex(color);
    const dot = h('button', {
      class: `palette-dot${hex === foregroundHex ? ' active' : ''}`,
      title: hex,
      onclick: () => store.setForeground(color),
    });
    dot.style.background = hex;
    paletteStrip.append(dot);
  }
}
const paletteSection = h('div', { class: 'options-section palette-section' }, [
  h('span', { class: 'row-label', text: 'Palette' }),
  paletteStrip,
]);

const zoomLabel = h('span', { class: 'row-label' });
const zoomSection = h('div', { class: 'options-section' }, [
  zoomLabel,
  h('button', { class: 'btn', text: 'Fit', onclick: () => fitToView() }),
  h('button', { class: 'btn', text: '100%', onclick: () => zoomToScale(1) }),
]);

const resizeLock = document.createElement('input');
resizeLock.type = 'checkbox';
resizeLock.checked = true;
let resizeRatio = 1;
const resizeWidthInput = numberInput(store.width || 512, 1, 100000, 1, () => undefined);
const resizeHeightInput = numberInput(store.height || 512, 1, 100000, 1, () => undefined);
resizeWidthInput.addEventListener('input', () => {
  if (resizeLock.checked) {
    const ratio = resizeRatio || 1;
    resizeHeightInput.value = String(Math.max(1, Math.round(readNumber(resizeWidthInput) / ratio)));
  }
});
resizeHeightInput.addEventListener('input', () => {
  if (resizeLock.checked) {
    const ratio = resizeRatio || 1;
    resizeWidthInput.value = String(Math.max(1, Math.round(readNumber(resizeHeightInput) * ratio)));
  }
});
resizeLock.addEventListener('change', () => {
  resizeRatio = readNumber(resizeWidthInput) / Math.max(1, readNumber(resizeHeightInput));
});
const resizeApplyButton = h('button', {
  class: 'btn',
  text: 'Resize Image',
  onclick: () => {
    if (!store.current) {
      return;
    }
    commitFloating();
    store.resizeDocument(
      Math.max(1, Math.round(readNumber(resizeWidthInput))),
      Math.max(1, Math.round(readNumber(resizeHeightInput))),
    );
  },
});
const resizeSection = h('div', { class: 'options-section' }, [
  h('span', { class: 'row-label', text: 'Width' }),
  resizeWidthInput,
  h('span', { class: 'row-label', text: 'Height' }),
  resizeHeightInput,
  h('span', { class: 'row-label', text: 'Lock' }),
  resizeLock,
  resizeApplyButton,
]);

const hintLabel = h('span', { class: 'row-label' });
const hintSection = h('div', { class: 'options-section' }, [hintLabel]);

const optionsBar = h('div', { class: 'options-bar' }, [
  brushSection,
  bucketSection,
  wandSection,
  zoomSection,
  resizeSection,
  paletteSection,
  hintSection,
]);

const main = h('div', { class: 'main' }, [toolsColumn, sidebar, dock, dockResizer, canvasArea]);
const app = h('div', { class: 'app' }, [toolbar, optionsBar, main]);

document.querySelector('#app')!.append(app);

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

function fitScale(img: ImageData): number {
  const area = canvasArea.getBoundingClientRect();
  return Math.min(1, area.width / img.width, area.height / img.height);
}

function currentScale(img: ImageData): number {
  return fitScale(img) * zoom;
}

function displayScale(): number {
  const img = store.current;
  return img ? currentScale(img) : 1;
}

function hitTolerance(): number {
  return Math.max(4, 8 / Math.max(displayScale(), 0.02));
}

function handleHalfSize(): number {
  return Math.max(2, 4 / Math.max(displayScale(), 0.02));
}

function applyCanvasLayout(): void {
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
}

function fitToView(): void {
  zoom = 1;
  offsetX = 0;
  offsetY = 0;
  applyCanvasLayout();
}

function zoomToScale(scaleFactor: number): void {
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

function zoomAtPoint(clientX: number, clientY: number, factor: number): void {
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

function toImagePoint(clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * store.width,
    y: ((clientY - rect.top) / rect.height) * store.height,
  };
}

function pointerPressure(event: PointerEvent): number {
  if ((event.pointerType === 'pen' || event.pointerType === 'touch') && event.pressure > 0) {
    return clamp(event.pressure, 0.02, 1);
  }
  return 1;
}

function sampleColorAt(img: ImageData, x: number, y: number): RGB {
  const px = clamp(Math.floor(x), 0, img.width - 1);
  const py = clamp(Math.floor(y), 0, img.height - 1);
  return getPixel(img, px, py);
}

// --- Selection overlay ---

let cachedSelectionMask: Uint8Array | null = null;
let cachedSelectionCanvas: HTMLCanvasElement | null = null;

function getSelectionCanvas(mask: Uint8Array): HTMLCanvasElement {
  if (cachedSelectionMask === mask && cachedSelectionCanvas) {
    return cachedSelectionCanvas;
  }
  const overlay = selectionOverlay(mask, store.width, store.height);
  const element = document.createElement('canvas');
  element.width = store.width;
  element.height = store.height;
  element.getContext('2d')!.putImageData(overlay, 0, 0);
  cachedSelectionMask = mask;
  cachedSelectionCanvas = element;
  return element;
}

let hoverPoint: { x: number; y: number } | null = null;

function redrawOverlay(): void {
  const context = overlayCanvas.getContext('2d');
  if (!context) {
    return;
  }
  context.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (floating) {
    drawFloatingToContext(context, floating);
  } else if (store.selection && store.width > 0) {
    context.drawImage(getSelectionCanvas(store.selection), 0, 0);
  }
  const box = store.activeTool === 'move' ? currentBox() : null;
  if (box) {
    drawBoxToContext(context, box, handleHalfSize());
  }
  if (hoverPoint && store.current && (store.activeTool === 'brush' || store.activeTool === 'eraser')) {
    const radius = Math.max(0.5, store.brushSize / 2);
    context.beginPath();
    context.arc(hoverPoint.x, hoverPoint.y, radius, 0, Math.PI * 2);
    context.lineWidth = 3;
    context.strokeStyle = 'rgba(0, 0, 0, 0.6)';
    context.stroke();
    context.beginPath();
    context.arc(hoverPoint.x, hoverPoint.y, radius, 0, Math.PI * 2);
    context.lineWidth = 1;
    context.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    context.stroke();
  }
}

// --- Pointer interaction state ---

let panning = false;
let panMoved = false;
let panLastX = 0;
let panLastY = 0;
let spaceHeld = false;

let strokeImage: ImageData | null = null;
let strokeLastX = 0;
let strokeLastY = 0;

let selecting: {
  type: 'marquee' | 'lasso';
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  points: { x: number; y: number }[];
} | null = null;

let moving: { startClientX: number; startClientY: number; offsetX: number; offsetY: number } | null = null;
let sampling = false;

function beginPan(event: PointerEvent): void {
  panning = true;
  panMoved = false;
  panLastX = event.clientX;
  panLastY = event.clientY;
  canvas.style.cursor = 'grabbing';
}

function beginMoveInteraction(event: PointerEvent, pointX: number, pointY: number): void {
  const box = currentBox();
  if (!box) {
    const layer = store.activeLayer;
    if (!layer) {
      return;
    }
    store.pushHistory();
    moving = {
      startClientX: event.clientX,
      startClientY: event.clientY,
      offsetX: layer.offsetX,
      offsetY: layer.offsetY,
    };
    return;
  }
  const hit = hitTestBox(box, pointX, pointY, hitTolerance());
  if (hit === null) {
    if (floating) {
      commitFloating();
    }
    return;
  }
  if (!floating && !liftToFloating(event.altKey)) {
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

canvas.addEventListener('pointerdown', (event) => {
  const img = store.current;
  if (!img) {
    return;
  }
  canvas.setPointerCapture(event.pointerId);
  const point = toImagePoint(event.clientX, event.clientY);
  const tool = store.activeTool;

  const picker = getActiveColorPicker();
  if (picker) {
    sampling = true;
    picker(sampleColorAt(img, point.x, point.y));
    return;
  }

  if (event.button === 1 || tool === 'hand' || spaceHeld) {
    beginPan(event);
    return;
  }
  if (event.button !== 0) {
    return;
  }

  // Alt+click with the brush or paint bucket acts as an eyedropper.
  if (event.altKey && (tool === 'brush' || tool === 'bucket')) {
    sampling = true;
    store.setForeground(sampleColorAt(img, point.x, point.y));
    return;
  }

  switch (tool) {
    case 'zoom':
      zoomAtPoint(event.clientX, event.clientY, event.altKey ? 1 / 1.5 : 1.5);
      break;
    case 'eyedropper':
      sampling = true;
      store.setForeground(sampleColorAt(img, point.x, point.y));
      break;
    case 'brush':
    case 'eraser': {
      const image = store.beginPaint();
      if (!image) {
        break;
      }
      strokeImage = image;
      strokeLastX = point.x;
      strokeLastY = point.y;
      paintSegment(image, point.x, point.y, point.x, point.y, pointerPressure(event));
      break;
    }
    case 'bucket': {
      const image = store.beginPaint();
      const layer = store.activeLayer;
      if (!image || !layer) {
        break;
      }
      floodFill(image, point.x, point.y, {
        color: store.foreground,
        alpha: store.brushOpacity,
        tolerance: store.fillTolerance,
        selection: store.selection,
        offsetX: layer.offsetX,
        offsetY: layer.offsetY,
      });
      store.notify();
      break;
    }
    case 'marquee':
      selecting = { type: 'marquee', startX: point.x, startY: point.y, currentX: point.x, currentY: point.y, points: [] };
      break;
    case 'lasso':
      selecting = {
        type: 'lasso',
        startX: point.x,
        startY: point.y,
        currentX: point.x,
        currentY: point.y,
        points: [{ x: point.x, y: point.y }],
      };
      break;
    case 'wand': {
      const mask = wandSelection(img, Math.floor(point.x), Math.floor(point.y), store.wandTolerance);
      store.setSelection(mask);
      break;
    }
    case 'move':
      beginMoveInteraction(event, point.x, point.y);
      break;
    case 'resize':
      break;
  }
});

canvas.addEventListener('pointermove', (event) => {
  const img = store.current;
  if (!img) {
    return;
  }
  const point = toImagePoint(event.clientX, event.clientY);

  if (store.activeTool === 'brush' || store.activeTool === 'eraser') {
    hoverPoint = { x: point.x, y: point.y };
    redrawOverlay();
  }

  if (panning) {
    offsetX += event.clientX - panLastX;
    offsetY += event.clientY - panLastY;
    panLastX = event.clientX;
    panLastY = event.clientY;
    if (Math.abs(event.movementX) + Math.abs(event.movementY) > 0) {
      panMoved = true;
    }
    applyCanvasLayout();
    return;
  }

  if (sampling) {
    const picker = getActiveColorPicker();
    const color = sampleColorAt(img, point.x, point.y);
    if (picker) {
      picker(color);
    } else {
      store.setForeground(color);
    }
    return;
  }

  if (strokeImage) {
    paintSegment(strokeImage, strokeLastX, strokeLastY, point.x, point.y, pointerPressure(event));
    strokeLastX = point.x;
    strokeLastY = point.y;
    return;
  }

  if (selecting) {
    selecting.currentX = point.x;
    selecting.currentY = point.y;
    if (selecting.type === 'lasso') {
      const last = selecting.points[selecting.points.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) > 1) {
        selecting.points.push({ x: point.x, y: point.y });
      }
    }
    const preview =
      selecting.type === 'marquee'
        ? rectSelection(store.width, store.height, selecting.startX, selecting.startY, point.x, point.y)
        : polygonSelection(store.width, store.height, selecting.points);
    store.setSelection(preview);
    return;
  }

  if (transformDrag && floating) {
    applyTransform(point.x, point.y, event.shiftKey);
    redrawOverlay();
    canvas.style.cursor =
      transformDrag.mode === 'move' ? 'grabbing' : cursorForHit(transformDrag.handle as BoxHit) ?? '';
    return;
  }

  if (moving) {
    const layer = store.activeLayer;
    if (layer) {
      const scale = currentScale(img) || 1;
      const dx = (event.clientX - moving.startClientX) / scale;
      const dy = (event.clientY - moving.startClientY) / scale;
      store.layers[store.activeIndex] = {
        ...layer,
        offsetX: Math.round(moving.offsetX + dx),
        offsetY: Math.round(moving.offsetY + dy),
      };
      store.notify();
    }
    return;
  }

  updateHoverCursor(point.x, point.y);
});

canvas.addEventListener('pointerleave', () => {
  hoverPoint = null;
  canvas.style.cursor = '';
  redrawOverlay();
});

function applyTransform(x: number, y: number, shiftKey: boolean): void {
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

function updateHoverCursor(x: number, y: number): void {
  if (store.activeTool !== 'move') {
    canvas.style.cursor = '';
    return;
  }
  const box = currentBox();
  if (!box) {
    canvas.style.cursor = '';
    return;
  }
  const cursor = cursorForHit(hitTestBox(box, x, y, hitTolerance()));
  canvas.style.cursor = cursor ?? '';
}

function endPointer(event: PointerEvent): void {
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
  if (strokeImage) {
    store.notify();
    strokeImage = null;
  }
  if (selecting) {
    if (selecting.type === 'marquee') {
      store.setSelection(
        rectSelection(store.width, store.height, selecting.startX, selecting.startY, selecting.currentX, selecting.currentY),
      );
    } else {
      store.setSelection(polygonSelection(store.width, store.height, selecting.points));
    }
    selecting = null;
  }
  moving = null;
  sampling = false;
  transformDrag = null;
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

function paintSegment(
  image: ImageData,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  pressure: number,
): void {
  const layer = store.activeLayer;
  const offsetXValue = layer ? layer.offsetX : 0;
  const offsetYValue = layer ? layer.offsetY : 0;
  const radius = Math.max(0.5, (store.brushSize / 2) * (0.35 + 0.65 * pressure));
  const alpha = clamp(store.brushOpacity * (0.25 + 0.75 * pressure), 0, 1);
  const params = {
    radius,
    color: store.foreground,
    alpha,
    selection: store.selection,
    erase: store.activeTool === 'eraser',
    soft: store.softBrush,
    offsetX: offsetXValue,
    offsetY: offsetYValue,
  };
  if (fromX === toX && fromY === toY) {
    stampBrush(image, toX, toY, params);
  } else {
    paintStroke(image, fromX, fromY, toX, toY, params);
  }
  store.notify();
}

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

window.addEventListener('resize', () => applyCanvasLayout());

// --- Keyboard shortcuts ---

window.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  const typing =
    target !== null && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  const ctrl = event.ctrlKey || event.metaKey;

  if (ctrl && event.key.toLowerCase() === 'z') {
    if (typing) {
      return;
    }
    event.preventDefault();
    if (floating) {
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
    if (!floating) {
      store.redo();
    }
    return;
  }
  if (ctrl && event.shiftKey && event.key.toLowerCase() === 'n') {
    event.preventDefault();
    commitFloating();
    store.addLayer();
    return;
  }
  if (ctrl && event.key.toLowerCase() === 'e') {
    event.preventDefault();
    commitFloating();
    store.mergeLayers();
    return;
  }
  if (ctrl && event.key.toLowerCase() === 'c') {
    if (typing) {
      return;
    }
    if (floating || store.selection) {
      event.preventDefault();
      void copySelectionToClipboard();
    }
    return;
  }
  if (typing || ctrl) {
    return;
  }
  if (event.key === 'Escape') {
    if (floating) {
      cancelFloating();
    } else {
      store.clearSelection();
    }
    return;
  }
  if (event.key === 'Enter') {
    if (floating) {
      commitFloating();
    }
    return;
  }
  if (event.key === ' ') {
    spaceHeld = true;
    event.preventDefault();
    return;
  }
  if (event.key === '[') {
    store.setBrushSize(Math.max(1, store.brushSize - 2));
    return;
  }
  if (event.key === ']') {
    store.setBrushSize(Math.min(500, store.brushSize + 2));
    return;
  }
  const tool = toolForShortcut(event.key);
  if (tool) {
    event.preventDefault();
    selectTool(tool);
  }
});

window.addEventListener('keyup', (event) => {
  if (event.key === ' ') {
    spaceHeld = false;
  }
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

// --- Rendering / state sync ---

function render(): void {
  const img = store.current;

  if (img) {
    if (canvas.width !== img.width || canvas.height !== img.height) {
      canvas.width = img.width;
      canvas.height = img.height;
      overlayCanvas.width = img.width;
      overlayCanvas.height = img.height;
    }
    if (store.revision !== lastRevision) {
      lastRevision = store.revision;
      canvas.getContext('2d')!.putImageData(img, 0, 0);
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
    imageSizeText.textContent = `${img.width}x${img.height}`;
  } else {
    imageSizeText.textContent = '';
    canvasStack.classList.remove('visible');
    canvasPlaceholder.classList.remove('hidden');
  }

  applyCanvasLayout();
  redrawOverlay();

  for (const [id, btn] of toolButtons) {
    btn.classList.toggle('active', id === store.activeTool);
  }
  if (document.activeElement !== brushSizeInput) {
    brushSizeInput.value = String(store.brushSize);
  }
  if (document.activeElement !== brushOpacityInput) {
    brushOpacityInput.value = String(Math.round(store.brushOpacity * 100));
  }
  if (document.activeElement !== wandToleranceInput) {
    wandToleranceInput.value = String(store.wandTolerance);
  }
  if (document.activeElement !== fillToleranceInput) {
    fillToleranceInput.value = String(store.fillTolerance);
  }
  renderPaletteStrip();
  if (document.activeElement !== resizeWidthInput && store.width > 0) {
    resizeWidthInput.value = String(store.width);
    resizeRatio = store.width / Math.max(1, store.height);
  }
  if (document.activeElement !== resizeHeightInput && store.height > 0) {
    resizeHeightInput.value = String(store.height);
  }
  brushSwatch.style.background = `rgb(${store.foreground.r}, ${store.foreground.g}, ${store.foreground.b})`;
  softBrushCheckbox.checked = store.softBrush;

  const tool = store.activeTool;
  const showBrush = tool === 'brush' || tool === 'eraser';
  const showBucket = tool === 'bucket';
  const showWand = tool === 'wand';
  const showZoom = tool === 'zoom';
  const showResize = tool === 'resize';
  const showPalette = tool === 'brush' || tool === 'bucket';
  brushSection.style.display = showBrush ? 'flex' : 'none';
  bucketSection.style.display = showBucket ? 'flex' : 'none';
  wandSection.style.display = showWand ? 'flex' : 'none';
  zoomSection.style.display = showZoom ? 'flex' : 'none';
  resizeSection.style.display = showResize ? 'flex' : 'none';
  paletteSection.style.display = showPalette ? 'flex' : 'none';
  hintSection.style.display = showBrush || showBucket || showWand || showZoom || showResize ? 'none' : 'flex';
  hintLabel.textContent =
    tool === 'move'
      ? 'Move: drag selection to move · handles to scale · just outside corners to rotate'
      : `Tool: ${tool} · Space+drag to pan · Ctrl+scroll to zoom`;

  undoButton.disabled = store.working || (!store.canUndo() && !floating);
  redoButton.disabled = store.working || !store.canRedo() || floating !== null;
  restoreButton.disabled = store.working || store.current === null;
  ditherButton.disabled = store.working;
  paletteButton.disabled = store.working;
  adjustmentsButton.disabled = store.working;
  effectsButton.disabled = store.working;
  layersButton.disabled = store.working;
  openButton.disabled = store.working;
  newButton.disabled = store.working;
  saveButton.disabled = store.working || store.current === null;
  statusText.textContent = store.status;
}

store.onChange(render);
render();
