import './style.css';
import { allBrushes, onBrushesChanged } from './brushLibrary';
import { brushFootprint, DEFAULT_BRUSH_ID, pressureFactor, textureModulates } from './brushes';
import { clamp, colorToHex, hexToColor, rgb, RGB } from './color';
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
import { createEmptyImage, getPixel, offsetImage, resizeImage } from './image';
import { compositeLayers } from './layers';
import {
  applySymmetrizedFill,
  drawSymmetryToContext,
  hitTestSymmetry,
  SymmetryTransform,
  symmetryTransforms,
  transformAngle,
  transformDirection,
} from './modifiers';
import { medianCut } from './palette';
import {
  combineSelection,
  polygonSelection,
  rectSelection,
  selectionOverlay,
  Selection,
  SelectionMode,
  wandSelection,
} from './selection';
import { Store } from './store';
import { drawText } from './text';
import { cloneStamp, floodFill, healStamp, knifeStamp, stampBrush, ToolId, toolForShortcut, TOOLS } from './tools';
import { openAdjustmentsPanel } from './ui/adjustmentsPanel';
import { openDitherPanel } from './ui/ditherPanel';
import { openEffectsPanel } from './ui/effectsPanel';
import { openLayersPanel } from './ui/layersPanel';
import { createMiniLayers, MiniLayers } from './ui/miniLayers';
import { openModifiersPanel } from './ui/modifiersPanel';
import { openNewFileDialog } from './ui/newFileDialog';
import { openPalettePanel } from './ui/palettePanel';
import { openSaveDialog } from './ui/saveDialog';
import { getActiveColorPicker, selectColorDialog } from './ui/selectColor';
import { openSettingsPanel } from './ui/settingsPanel';
import { createTimeline, Timeline } from './ui/timeline';

const store = new Store();

let timeline: Timeline | null = null;
let miniLayers: MiniLayers | null = null;

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

// In-progress symmetry guide drag (Modifiers panel transform mode).
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
  if (store.activeTool === 'resize' && store.width > 0) {
    return { cx: store.width / 2, cy: store.height / 2, w: store.width, h: store.height, rotation: 0 };
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
  floatingMask = store.selection;
  floatingOriginCx = result.floating.cx;
  floatingOriginCy = result.floating.cy;
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

function commitFloating(): void {
  if (!floating) {
    return;
  }
  const layer = store.activeLayer;
  const box = boxFromFloating(floating);
  if (layer) {
    const baked = bakeFloating(floating, store.width, store.height);
    const target = createEmptyImage(store.width, store.height);
    target.data.set(layer.image.data);
    compositeOverLayer(target, baked, layer.offsetX, layer.offsetY);
    store.layers[store.activeIndex] = { ...layer, image: target };
  }
  const transformed = floatingMask
    ? transformMask(floatingMask, floatingOriginCx, floatingOriginCy, floating)
    : selectionForBox(box);
  floating = null;
  floatingMask = null;
  store.selection = transformed;
  store.notify();
}

function cancelFloating(): void {
  if (!floating) {
    return;
  }
  floating = null;
  floatingMask = null;
  store.clearSelection();
  store.undo();
}

// --- Layout ---

const canvas = h('canvas', { class: 'main-canvas' });
const overlayCanvas = h('canvas', { class: 'overlay-canvas' });
const canvasStack = h('div', { class: 'canvas-stack' }, [canvas, overlayCanvas]);
const canvasPlaceholder = h('div', {
  class: 'placeholder',
  text: 'Open, paste or create a new file to begin',
});
const canvasArea = h('div', { class: 'canvas-area' }, [canvasStack, canvasPlaceholder]);
const resizePreview = h('div', { class: 'resize-preview' });
canvasArea.append(resizePreview);
const minimapCanvas = h('canvas', { class: 'minimap-canvas' });
const minimap = h('div', { class: 'minimap' }, [minimapCanvas]);
minimap.style.display = 'none';
canvasArea.append(minimap);

const samplePreview = h('div', { class: 'sample-preview' });
document.body.append(samplePreview);

function showSamplePreview(clientX: number, clientY: number, color: RGB): void {
  samplePreview.style.background = `rgb(${color.r}, ${color.g}, ${color.b})`;
  samplePreview.style.left = `${clientX + 16}px`;
  samplePreview.style.top = `${clientY + 16}px`;
  samplePreview.classList.add('visible');
}

function hideSamplePreview(): void {
  samplePreview.classList.remove('visible');
}
const dock = h('div', { class: 'dock hidden' });
const dockResizer = h('div', { class: 'dock-resizer' });

const imageSizeText = h('span', { class: 'image-size' });
const statusText = h('span', { class: 'status' });

const ctx: AppContext = {
  store,
  dock,
  selectColor: (initial, onChange) => selectColorDialog(initial, onChange),
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
let settingsPanel: DockPanel | null = null;
let modifiersPanel: DockPanel | null = null;

// Refreshes a panel's toggle button and the layout after opening/closing.
function panelChanged(): void {
  applyCanvasLayout();
  miniLayers?.sync();
  syncPanelButtons();
}

const togglePanels: Record<string, () => void> = {
  palette: () => {
    if (palettePanel) {
      palettePanel.close();
      return;
    }
    palettePanel = openPalettePanel(ctx, () => {
      palettePanel = null;
      panelChanged();
    });
    panelChanged();
  },
  dither: () => {
    if (ditherPanel) {
      ditherPanel.close();
      return;
    }
    ditherPanel = openDitherPanel(ctx, () => {
      ditherPanel = null;
      panelChanged();
    });
    panelChanged();
  },
  adjustments: () => {
    if (adjustmentsPanel) {
      adjustmentsPanel.close();
      return;
    }
    adjustmentsPanel = openAdjustmentsPanel(ctx, () => {
      adjustmentsPanel = null;
      panelChanged();
    });
    panelChanged();
  },
  effects: () => {
    if (effectsPanel) {
      effectsPanel.close();
      return;
    }
    effectsPanel = openEffectsPanel(ctx, () => {
      effectsPanel = null;
      panelChanged();
    });
    panelChanged();
  },
  modifiers: () => {
    if (modifiersPanel) {
      modifiersPanel.close();
      return;
    }
    modifiersPanel = openModifiersPanel(ctx, () => {
      modifiersPanel = null;
      panelChanged();
    });
    panelChanged();
  },
  layers: () => {
    if (layersPanel) {
      layersPanel.close();
      return;
    }
    layersPanel = openLayersPanel(ctx, () => {
      layersPanel = null;
      panelChanged();
    });
    panelChanged();
  },
  settings: () => {
    if (settingsPanel) {
      settingsPanel.close();
      return;
    }
    settingsPanel = openSettingsPanel(ctx, () => {
      settingsPanel = null;
      panelChanged();
    });
    panelChanged();
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

function openDocument(image: ImageData, refreshPalette = false): void {
  commitFloating();
  const hadDocument = store.current !== null;
  store.openImage(image);
  if (!hadDocument || refreshPalette) {
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

function newDocument(width?: number, height?: number): void {
  if (store.working) {
    return;
  }
  commitFloating();
  const w = Math.max(1, width ?? store.settings.canvasWidth);
  const h = Math.max(1, height ?? store.settings.canvasHeight);
  const background = store.settings.blankNewImage ? null : hexToColor(store.settings.backgroundColor);
  store.newDocument(w, h, background);
  store.palette = BASE_COLORS.map((color) => ({ ...color }));
  store.emit();
}

const newButton = h('button', {
  class: 'btn toolbar-btn',
  text: 'New File',
  onclick: async () => {
    if (store.working) {
      return;
    }
    const choice = await openNewFileDialog(store);
    if (!choice) {
      return;
    }
    if ('image' in choice) {
      // A new file always resets the palette; when it comes from an image,
      // derive it from that image like a first paste does.
      openDocument(choice.image, true);
      return;
    }
    store.updateSettings({ canvasWidth: choice.width, canvasHeight: choice.height });
    newDocument(choice.width, choice.height);
  },
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
function saveDocument(): void {
  if (store.current && !store.working) {
    timeline?.stopPlayback();
    if (textEditing) {
      commitText();
    }
    commitFloating();
    openSaveDialog(store);
  }
}

const saveButton = h('button', {
  class: 'btn toolbar-btn',
  text: 'Save File',
  title: 'Save File (Ctrl+S)',
  onclick: () => saveDocument(),
});
const undoButton = h('button', {
  class: 'btn toolbar-btn',
  text: 'Undo',
  title: 'Undo (Ctrl+Z)',
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
  title: 'Redo (Ctrl+Y)',
  onclick: () => {
    if (!store.working && !floating) {
      store.redo();
    }
  },
});
const restoreButton = h('button', {
  class: 'btn toolbar-btn',
  text: 'Restore',
  onclick: () => {
    if (!store.working) {
      commitFloating();
      store.restore();
    }
  },
});

const toolbar = h('div', { class: 'toolbar' }, [
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

// --- Tool strip ---

function selectTool(tool: ToolId): void {
  if (textEditing) {
    commitText();
  }
  if (floating && tool !== 'move') {
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

// --- Sidebar (docked panels) ---

const ditherButton = h('button', { class: 'btn sidebar-btn', text: 'Dither', onclick: () => togglePanels.dither() });
const paletteButton = h('button', { class: 'btn sidebar-btn', text: 'Palette', onclick: () => togglePanels.palette() });
const adjustmentsButton = h('button', {
  class: 'btn sidebar-btn',
  text: 'Adjustments',
  onclick: () => togglePanels.adjustments(),
});
const effectsButton = h('button', { class: 'btn sidebar-btn', text: 'Effects', onclick: () => togglePanels.effects() });
const modifiersButton = h('button', {
  class: 'btn sidebar-btn',
  text: 'Modifiers',
  onclick: () => togglePanels.modifiers(),
});
const layersButton = h('button', { class: 'btn sidebar-btn', text: 'Layers', onclick: () => togglePanels.layers() });
const settingsButton = h('button', {
  class: 'btn sidebar-btn',
  text: 'Settings',
  onclick: () => togglePanels.settings(),
});

// Highlights a sidebar button while its panel is open (like the active tool).
function syncPanelButtons(): void {
  paletteButton.classList.toggle('active', palettePanel !== null);
  ditherButton.classList.toggle('active', ditherPanel !== null);
  adjustmentsButton.classList.toggle('active', adjustmentsPanel !== null);
  effectsButton.classList.toggle('active', effectsPanel !== null);
  modifiersButton.classList.toggle('active', modifiersPanel !== null);
  layersButton.classList.toggle('active', layersPanel !== null);
  settingsButton.classList.toggle('active', settingsPanel !== null);
}

miniLayers = createMiniLayers(store, () => layersPanel !== null);

const sidebar = h('div', { class: 'sidebar' }, [
  ditherButton,
  paletteButton,
  adjustmentsButton,
  effectsButton,
  modifiersButton,
  layersButton,
  settingsButton,
  h('div', { class: 'sidebar-spacer' }),
  miniLayers.root,
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
brushSizeInput.title = 'Brush size in pixels.';
const brushOpacityInput = numberInput(Math.round(store.brushOpacity * 100), 0, 100, 1, () =>
  store.setBrushOpacity(clamp(readNumber(brushOpacityInput) / 100, 0, 1)),
);
brushOpacityInput.title = 'Brush opacity, from 0 to 100%.';
const brushSwatch = h('span', { class: 'palette-swatch small' });
const pickForegroundButton = h('button', {
  class: 'btn',
  text: 'Color',
  title: 'Pick the paint color; changes apply to the brush immediately.',
  onclick: async () => {
    // Live picker: every change (typing or sampling from the image) updates
    // the brush color right away.
    const chosen = await ctx.selectColor(store.foreground, (color) => store.setForeground(color));
    store.setForeground(chosen);
  },
});
// Brush pickers list the brush library (defaults plus user edits and custom
// brushes); they are rebuilt whenever the library changes in the settings.
function fillBrushSelect(select: HTMLSelectElement): void {
  select.replaceChildren(...allBrushes().map((brush) => h('option', { value: brush.id, text: brush.label })));
  select.value = store.brushId;
}
function createBrushSelect(): HTMLSelectElement {
  const select = h('select', { class: 'select' });
  select.title = 'Brush tip shape and texture.';
  select.addEventListener('change', () => store.setBrush(select.value));
  fillBrushSelect(select);
  return select;
}
const brushSelect = createBrushSelect();
const brushSection = h('div', { class: 'options-section' }, [
  h('span', { class: 'row-label', text: 'Brush' }),
  brushSelect,
  h('span', { class: 'row-label', text: 'Size' }),
  brushSizeInput,
  h('span', { class: 'row-label', text: 'Opacity' }),
  brushOpacityInput,
  h('span', { class: 'row-label', text: 'Color' }),
  brushSwatch,
  pickForegroundButton,
]);

// Palette knife controls edit the same size/opacity state as the brush, but
// live in their own inputs so they can be shown independently.
const knifeSizeInput = numberInput(store.brushSize, 1, 500, 1, () => store.setBrushSize(readNumber(knifeSizeInput)));
knifeSizeInput.title = 'Knife size in pixels.';
const knifeStrengthInput = numberInput(Math.round(store.brushOpacity * 100), 0, 100, 1, () =>
  store.setBrushOpacity(clamp(readNumber(knifeStrengthInput) / 100, 0, 1)),
);
knifeStrengthInput.title = 'How strongly the knife lays the picked-up paint back down.';
const knifeSmearInput = numberInput(Math.round(store.knifeSmear * 100), 0, 100, 1, () =>
  store.setKnifeSmear(clamp(readNumber(knifeSmearInput) / 100, 0, 1)),
);
knifeSmearInput.title = 'How far behind the cursor the knife samples paint to smear along the stroke.';
const knifeSelect = createBrushSelect();
const knifeSection = h('div', { class: 'options-section' }, [
  h('span', { class: 'row-label', text: 'Brush' }),
  knifeSelect,
  h('span', { class: 'row-label', text: 'Size' }),
  knifeSizeInput,
  h('span', { class: 'row-label', text: 'Strength' }),
  knifeStrengthInput,
  h('span', { class: 'row-label', text: 'Smear' }),
  knifeSmearInput,
]);
onBrushesChanged(() => {
  // A custom brush that was deleted may still be the active one; fall back to Round.
  if (!allBrushes().some((brush) => brush.id === store.brushId)) {
    store.setBrush(DEFAULT_BRUSH_ID);
  }
  fillBrushSelect(brushSelect);
  fillBrushSelect(knifeSelect);
});

const wandToleranceInput = numberInput(store.wandTolerance, 0, 255, 1, () =>
  store.setWandTolerance(readNumber(wandToleranceInput)),
);
wandToleranceInput.title = 'How different a color can be and still be selected by the magic wand.';
const wandSection = h('div', { class: 'options-section' }, [
  h('span', { class: 'row-label', text: 'Tolerance' }),
  wandToleranceInput,
]);

const fillToleranceInput = numberInput(store.fillTolerance, 0, 255, 1, () =>
  store.setFillTolerance(readNumber(fillToleranceInput)),
);
fillToleranceInput.title = 'How different a color can be and still be filled by the paint bucket.';
const bucketSection = h('div', { class: 'options-section' }, [
  h('span', { class: 'row-label', text: 'Tolerance' }),
  fillToleranceInput,
]);

const paletteStrip = h('div', { class: 'palette-strip' });
let lastPaletteSignature = '';
const paletteDots: HTMLButtonElement[] = [];

function paletteKeyHint(index: number): string {
  // The first ten entries are reachable with the number row (1-9, then 0).
  return index < 9 ? String(index + 1) : index === 9 ? '0' : '';
}

function renderPaletteStrip(): void {
  const foregroundHex = colorToHex(store.foreground);
  const paletteSignature = store.palette.map((color) => colorToHex(color)).join(',');
  if (paletteSignature !== lastPaletteSignature) {
    lastPaletteSignature = paletteSignature;
    paletteStrip.replaceChildren();
    paletteDots.length = 0;
    store.palette.forEach((color, index) => {
      const dot = h('button', {
        class: 'palette-dot',
        onclick: () => store.setForeground(store.palette[index]),
      });
      // Double click edits this palette entry in the color picker. When it is
      // the selected (active) swatch, the edited color also becomes the
      // current brush/text color.
      dot.addEventListener('dblclick', async () => {
        const wasActive = colorToHex(store.foreground) === colorToHex(store.palette[index]);
        const chosen = await ctx.selectColor(store.palette[index]);
        store.palette[index] = chosen;
        if (wasActive) {
          store.setForeground(chosen);
        }
        store.emit();
      });
      paletteStrip.append(dot);
      paletteDots.push(dot);
    });
  }
  // Update the dots in place. Rebuilding them on every foreground change would
  // destroy the element between the two clicks of a double click, which makes
  // the second click (and the dblclick) land on a different element.
  paletteDots.forEach((dot, index) => {
    const color = store.palette[index];
    if (!color) {
      return;
    }
    const hex = colorToHex(color);
    dot.style.background = hex;
    dot.classList.toggle('active', hex === foregroundHex);
    const keyHint = paletteKeyHint(index);
    dot.title = keyHint ? `${hex} (${keyHint})` : hex;
  });
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
resizeLock.title = 'Keep the current aspect ratio while resizing.';
let resizeRatio = 1;
const resizeWidthInput = numberInput(store.width || 512, 1, 100000, 1, () => undefined);
resizeWidthInput.title = 'Target document width in pixels.';
const resizeHeightInput = numberInput(store.height || 512, 1, 100000, 1, () => undefined);
resizeHeightInput.title = 'Target document height in pixels.';
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
const resizeScaleCheckbox = document.createElement('input');
resizeScaleCheckbox.type = 'checkbox';
resizeScaleCheckbox.title = 'Scale the image content with the canvas. When off, only the canvas size changes.';

// Applies the width/height fields (used by both Enter/blur and the button).
function applyResizeFromInputs(): void {
  if (!store.current) {
    return;
  }
  const width = Math.max(1, Math.round(readNumber(resizeWidthInput)));
  const height = Math.max(1, Math.round(readNumber(resizeHeightInput)));
  if (width === store.width && height === store.height) {
    return;
  }
  commitFloating();
  if (resizeScaleCheckbox.checked) {
    store.resizeDocument(width, height);
  } else {
    store.resizeCanvas(width, height, 0, 0);
  }
}

resizeWidthInput.addEventListener('change', applyResizeFromInputs);
resizeHeightInput.addEventListener('change', applyResizeFromInputs);

const resizeApplyButton = h('button', {
  class: 'btn',
  text: 'Resize Image',
  onclick: () => applyResizeFromInputs(),
});
const resizeSection = h('div', { class: 'options-section' }, [
  h('span', { class: 'row-label', text: 'Width' }),
  resizeWidthInput,
  h('span', { class: 'row-label', text: 'Height' }),
  resizeHeightInput,
  h('span', { class: 'row-label', text: 'Lock' }),
  resizeLock,
  h('span', { class: 'row-label', text: 'Scale' }),
  resizeScaleCheckbox,
  resizeApplyButton,
]);

const hintLabel = h('span', { class: 'row-label' });
const hintSection = h('div', { class: 'options-section' }, [hintLabel]);

const textSizeInput = numberInput(store.textSize, 1, 500, 1, () => store.setTextSize(readNumber(textSizeInput)));
textSizeInput.title = 'Text size in pixels.';

const textFontSelect = h('select', { class: 'select' });
for (const [value, label] of [
  ['sans-serif', 'Sans'],
  ['serif', 'Serif'],
  ['monospace', 'Mono'],
  ['cursive', 'Cursive'],
  ['fantasy', 'Fantasy'],
] as [string, string][]) {
  textFontSelect.append(h('option', { value, text: label }));
}
textFontSelect.value = store.textFont;
textFontSelect.title = 'Font family for the text tool.';
textFontSelect.addEventListener('change', () => store.setTextFont(textFontSelect.value));

const textBoldCheckbox = document.createElement('input');
textBoldCheckbox.type = 'checkbox';
textBoldCheckbox.checked = store.textBold;
textBoldCheckbox.title = 'Render the text in bold.';
textBoldCheckbox.addEventListener('change', () => store.setTextBold(textBoldCheckbox.checked));

const textItalicCheckbox = document.createElement('input');
textItalicCheckbox.type = 'checkbox';
textItalicCheckbox.checked = store.textItalic;
textItalicCheckbox.title = 'Render the text in italics.';
textItalicCheckbox.addEventListener('change', () => store.setTextItalic(textItalicCheckbox.checked));

const textSwatch = h('span', { class: 'palette-swatch small' });
const textPickButton = h('button', {
  class: 'btn',
  text: 'Color',
  title: 'Pick the text color; changes apply immediately.',
  onclick: async () => {
    const chosen = await ctx.selectColor(store.foreground, (color) => store.setForeground(color));
    store.setForeground(chosen);
  },
});

const textSection = h('div', { class: 'options-section' }, [
  h('span', { class: 'row-label', text: 'Size' }),
  textSizeInput,
  h('span', { class: 'row-label', text: 'Font' }),
  textFontSelect,
  h('span', { class: 'row-label', text: 'Bold' }),
  textBoldCheckbox,
  h('span', { class: 'row-label', text: 'Italic' }),
  textItalicCheckbox,
  textSwatch,
  textPickButton,
]);

const optionsBar = h('div', { class: 'options-bar' }, [
  brushSection,
  knifeSection,
  bucketSection,
  wandSection,
  zoomSection,
  resizeSection,
  textSection,
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
  renderMinimap();
  // The selection border and transform box are sized for the zoom level, so
  // zooming in or out has to regenerate the overlay.
  if (scale !== overlayScale) {
    redrawOverlay();
  }
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
// applyCanvasLayout (pan/zoom/resize) and render (content changes) so it always
// reflects what is on screen.
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

// Samples a color, routes it to the active color picker (or the foreground)
// and shows the swatch preview. Shared by the eyedropper and Alt+brush/bucket.
function applySample(img: ImageData, x: number, y: number, clientX: number, clientY: number): void {
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

// In-progress text (Text tool): typed directly on the canvas, committed on Enter.
let textEditing: { x: number; y: number; content: string } | null = null;
let caretOn = true;
let caretTimer = 0;

// The exact selection mask captured when a floating move/copy began, plus the
// floating's initial center, so it can be transformed to follow the content.
let floatingMask: Selection | null = null;
let floatingOriginCx = 0;
let floatingOriginCy = 0;

function startCaretBlink(): void {
  stopCaretBlink();
  caretOn = true;
  caretTimer = window.setInterval(() => {
    caretOn = !caretOn;
    redrawOverlay();
  }, 500);
}

function stopCaretBlink(): void {
  if (caretTimer) {
    window.clearInterval(caretTimer);
    caretTimer = 0;
  }
}

function textFontString(): string {
  return `${store.textItalic ? 'italic ' : ''}${store.textBold ? 'bold ' : ''}${store.textSize}px ${store.textFont}`;
}

function commitText(): void {
  if (!textEditing) {
    return;
  }
  const { x, y, content } = textEditing;
  textEditing = null;
  stopCaretBlink();
  const layer = store.activeLayer;
  if (content.trim() && layer) {
    const updated = drawText(
      layer.image,
      store.width,
      store.height,
      layer.offsetX,
      layer.offsetY,
      content,
      x,
      y,
      {
        size: store.textSize,
        font: store.textFont,
        bold: store.textBold,
        italic: store.textItalic,
        color: store.foreground,
      },
    );
    ctx.applyImage(updated);
  }
  redrawOverlay();
}

function cancelText(): void {
  if (!textEditing) {
    return;
  }
  textEditing = null;
  stopCaretBlink();
  redrawOverlay();
}

// Draws the in-progress marquee/lasso outline. The real mask is only built
// when the drag ends, so dragging stays smooth even on large documents.
function drawSelectionPreview(context: CanvasRenderingContext2D): void {
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

function redrawOverlay(): void {
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
  if (floating) {
    drawFloatingToContext(context, floating);
  } else if (store.selection && store.width > 0) {
    const selection = getSelectionCanvas(store.selection);
    if (selection) {
      context.drawImage(selection.canvas, selection.x, selection.y);
    }
  }
  if (selecting) {
    drawSelectionPreview(context);
  }
  const box = store.activeTool === 'move' || store.activeTool === 'resize' ? currentBox() : null;
  if (box) {
    // Thicken the box lines when zoomed out so they do not disappear.
    drawBoxToContext(context, box, handleHalfSize(), Math.max(1, 1 / Math.max(displayScale(), 0.02)));
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
  if (textEditing) {
    context.save();
    context.font = textFontString();
    context.textBaseline = 'top';
    context.fillStyle = `rgb(${store.foreground.r}, ${store.foreground.g}, ${store.foreground.b})`;
    context.fillText(textEditing.content, textEditing.x, textEditing.y);
    if (caretOn) {
      const width = context.measureText(textEditing.content).width;
      context.fillStyle = 'rgba(255, 255, 255, 0.9)';
      context.fillRect(textEditing.x + width + 1, textEditing.y, Math.max(1, store.textSize * 0.06), store.textSize);
    }
    context.restore();
  }
  if (store.activeTool === 'clone') {
    let markerX: number | null = null;
    let markerY: number | null = null;
    if (cloneOffset && hoverPoint) {
      markerX = hoverPoint.x - cloneOffset.x;
      markerY = hoverPoint.y - cloneOffset.y;
    } else if (cloneSource) {
      markerX = cloneSource.x;
      markerY = cloneSource.y;
    }
    if (markerX !== null && markerY !== null) {
      context.beginPath();
      context.arc(markerX, markerY, Math.max(2, store.brushSize * 0.3), 0, Math.PI * 2);
      context.lineWidth = 1;
      context.strokeStyle = 'rgba(0, 255, 255, 0.9)';
      context.stroke();
      context.beginPath();
      context.moveTo(markerX - 4, markerY);
      context.lineTo(markerX + 4, markerY);
      context.moveTo(markerX, markerY - 4);
      context.lineTo(markerX, markerY + 4);
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

// --- Pointer interaction state ---

let panning = false;
let panMoved = false;
let panLastX = 0;
let panLastY = 0;
let spaceHeld = false;

let strokeImage: ImageData | null = null;
let strokeSource: ImageData | null = null;
let strokeKind: 'brush' | 'eraser' | 'clone' | 'heal' | 'knife' = 'brush';
let strokeLastX = 0;
let strokeLastY = 0;
// Symmetry copies for the current stroke (null when the modifier is off).
let strokeTransforms: SymmetryTransform[] | null = null;
// Texture is sampled in stroke space, so a stroke tracks its own arc length,
// a random phase (to vary each stroke) and a per-stamp rotation jitter seed.
let strokeDistance = 0;
let strokeSeedX = 0;
let strokeSeedY = 0;
let strokeJitterSeed = 0;
let strokeStampIndex = 0;
// Per-stroke coverage cap used by textured brushes so grain is not filled in,
// plus a snapshot of the layer's pixels at stroke start to blend against.
let strokeMask: Float32Array | null = null;
let strokeBase: Uint8ClampedArray | null = null;

function beginStrokeState(textured: boolean, image: ImageData): void {
  strokeDistance = 0;
  strokeSeedX = Math.random() * 4096;
  strokeSeedY = Math.random() * 4096;
  strokeJitterSeed = (Math.random() * 0x7fffffff) | 0;
  strokeStampIndex = 0;
  strokeMask = textured ? new Float32Array(image.width * image.height) : null;
  strokeBase = textured ? new Uint8ClampedArray(image.data) : null;
  // The guide cannot move mid-stroke, so its transforms are captured once.
  strokeTransforms = store.symmetry.enabled ? symmetryTransforms(store.symmetry) : null;
}

// Runs `fn` for the original stamp and for every symmetric copy.
function forEachStrokeTransform(fn: (transform: SymmetryTransform | null) => void): void {
  if (!strokeTransforms) {
    fn(null);
    return;
  }
  for (const transform of strokeTransforms) {
    fn(transform);
  }
}

// Deterministic 0..1 hash used to jitter each stamp's tip rotation.
function hash01(n: number): number {
  let h = Math.imul(n ^ (n >>> 15), 2246822519);
  h = Math.imul(h ^ (h >>> 13), 3266489917);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

// Clone Stamp source point / offset (document space).
let cloneSource: { x: number; y: number } | null = null;
let cloneOffset: { x: number; y: number } | null = null;

function isBrushTool(tool: ToolId): boolean {
  return tool === 'brush' || tool === 'eraser' || tool === 'clone' || tool === 'heal' || tool === 'knife';
}

let selecting: {
  type: 'marquee' | 'lasso';
  startX: number;
  startY: number;
  startClientX: number;
  startClientY: number;
  currentX: number;
  currentY: number;
  moved: boolean;
  points: { x: number; y: number }[];
} | null = null;

// Selection boolean mode captured when a selection drag starts.
let selectionMode: SelectionMode = 'replace';
let selectionBase: Selection | null = null;

function selectionModeFor(event: PointerEvent): SelectionMode {
  if (event.shiftKey) {
    return 'add';
  }
  if (event.altKey) {
    return 'subtract';
  }
  return 'replace';
}

let moving: { startClientX: number; startClientY: number; offsetX: number; offsetY: number } | null = null;
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

function layersToCanvas(layers: typeof store.layers): HTMLCanvasElement | null {
  if (!layers.some((layer) => layer.visible && layer.opacity > 0)) {
    return null;
  }
  return imageToCanvas(compositeLayers(layers, store.width, store.height));
}

function buildMovePreview(): void {
  const layer = store.activeLayer;
  if (!layer) {
    movePreview = null;
    return;
  }
  movePreview = {
    below: layersToCanvas(store.layers.slice(0, store.activeIndex)),
    above: layersToCanvas(store.layers.slice(store.activeIndex + 1)),
    layer: imageToCanvas(layer.image),
  };
}

function drawMovePreview(): void {
  const layer = store.activeLayer;
  const context = canvas.getContext('2d');
  if (!movePreview || !layer || !context) {
    return;
  }
  context.clearRect(0, 0, canvas.width, canvas.height);
  if (movePreview.below) {
    context.drawImage(movePreview.below, 0, 0);
  }
  context.globalAlpha = layer.opacity;
  context.drawImage(movePreview.layer, layer.offsetX, layer.offsetY);
  context.globalAlpha = 1;
  if (movePreview.above) {
    context.drawImage(movePreview.above, 0, 0);
  }
  canvasValid = true;
}

let resizeDrag: {
  handle: string;
  startWidth: number;
  startHeight: number;
  startBox: { cx: number; cy: number; w: number; h: number };
} | null = null;
let resizePending: { width: number; height: number; left: number; top: number } | null = null;

function showResizePreview(left: number, top: number, width: number, height: number): void {
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

function hideResizePreview(): void {
  resizePreview.style.display = 'none';
}

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
    buildMovePreview();
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

function bakeActiveLayerOffset(): void {
  const layer = store.activeLayer;
  if (!layer || (layer.offsetX === 0 && layer.offsetY === 0)) {
    return;
  }
  const baked = offsetImage(layer.image, layer.offsetX, layer.offsetY);
  store.layers[store.activeIndex] = { ...layer, image: baked, offsetX: 0, offsetY: 0 };
  store.notify();
}

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
    applySample(img, point.x, point.y, event.clientX, event.clientY);
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
    applySample(img, point.x, point.y, event.clientX, event.clientY);
    return;
  }

  switch (tool) {
    case 'zoom':
      zoomAtPoint(event.clientX, event.clientY, event.altKey ? 1 / 1.5 : 1.5);
      break;
    case 'eyedropper':
      sampling = true;
      applySample(img, point.x, point.y, event.clientX, event.clientY);
      break;
    case 'brush':
    case 'eraser': {
      const image = store.beginPaint();
      if (!image) {
        break;
      }
      strokeKind = tool === 'eraser' ? 'eraser' : 'brush';
      strokeSource = null;
      strokeImage = image;
      strokeLastX = point.x;
      strokeLastY = point.y;
      beginStrokeState(textureModulates(store.brush.texture), image);
      paintStrokeSegment(point.x, point.y, point.x, point.y, pointerPressure(event));
      break;
    }
    case 'clone': {
      if (event.altKey) {
        cloneSource = { x: point.x, y: point.y };
        cloneOffset = null;
        redrawOverlay();
        break;
      }
      const before = store.activeLayer;
      if (!before || !cloneSource) {
        break;
      }
      const source = before.image;
      const image = store.beginPaint();
      if (!image) {
        break;
      }
      if (!cloneOffset) {
        cloneOffset = { x: point.x - cloneSource.x, y: point.y - cloneSource.y };
      }
      strokeKind = 'clone';
      strokeSource = source;
      strokeImage = image;
      strokeLastX = point.x;
      strokeLastY = point.y;
      beginStrokeState(false, image);
      paintStrokeSegment(point.x, point.y, point.x, point.y, pointerPressure(event));
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
      strokeKind = 'heal';
      strokeSource = source;
      strokeImage = image;
      strokeLastX = point.x;
      strokeLastY = point.y;
      beginStrokeState(false, image);
      paintStrokeSegment(point.x, point.y, point.x, point.y, pointerPressure(event));
      break;
    }
    case 'knife': {
      const image = store.beginPaint();
      if (!image) {
        break;
      }
      strokeKind = 'knife';
      strokeSource = null;
      strokeImage = image;
      strokeLastX = point.x;
      strokeLastY = point.y;
      beginStrokeState(false, image);
      paintStrokeSegment(point.x, point.y, point.x, point.y, pointerPressure(event));
      break;
    }
    case 'bucket': {
      const image = store.beginPaint();
      const layer = store.activeLayer;
      if (!image || !layer) {
        break;
      }
      const fill = floodFill(image, point.x, point.y, {
        color: store.foreground,
        alpha: store.brushOpacity,
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
      selectionBase = store.selection;
      selectionMode = selectionModeFor(event);
      selecting = {
        type: 'marquee',
        startX: point.x,
        startY: point.y,
        startClientX: event.clientX,
        startClientY: event.clientY,
        currentX: point.x,
        currentY: point.y,
        moved: false,
        points: [],
      };
      break;
    case 'lasso':
      selectionBase = store.selection;
      selectionMode = selectionModeFor(event);
      selecting = {
        type: 'lasso',
        startX: point.x,
        startY: point.y,
        startClientX: event.clientX,
        startClientY: event.clientY,
        currentX: point.x,
        currentY: point.y,
        moved: false,
        points: [{ x: point.x, y: point.y }],
      };
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
      if (textEditing) {
        commitText();
      }
      textEditing = { x: point.x, y: point.y, content: '' };
      startCaretBlink();
      canvas.style.cursor = 'text';
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
    hoverPoint = { x: point.x, y: point.y };
    // During a stroke the overlay is refreshed once per animation frame by the
    // paint update; redrawing it per pointer event would just do the same work
    // many times per shown frame.
    if (!strokeImage) {
      redrawOverlay();
    }
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
    applySample(img, point.x, point.y, event.clientX, event.clientY);
    return;
  }

  if (strokeImage) {
    paintStrokeSegment(strokeLastX, strokeLastY, point.x, point.y, pointerPressure(event));
    strokeLastX = point.x;
    strokeLastY = point.y;
    return;
  }

  if (selecting) {
    selecting.currentX = point.x;
    selecting.currentY = point.y;
    if (Math.abs(event.clientX - selecting.startClientX) + Math.abs(event.clientY - selecting.startClientY) > 3) {
      selecting.moved = true;
    }
    if (selecting.type === 'lasso') {
      const last = selecting.points[selecting.points.length - 1];
      if (Math.hypot(point.x - last.x, point.y - last.y) > 1) {
        selecting.points.push({ x: point.x, y: point.y });
      }
    }
    // Only the outline is drawn while dragging; the mask is built on release.
    redrawOverlay();
    return;
  }

  if (transformDrag && floating) {
    applyTransform(point.x, point.y, event.shiftKey);
    redrawOverlay();
    canvas.style.cursor =
      transformDrag.mode === 'move' ? 'grabbing' : cursorForHit(transformDrag.handle as BoxHit) ?? '';
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
    if (document.activeElement !== resizeWidthInput) {
      resizeWidthInput.value = String(width);
    }
    if (document.activeElement !== resizeHeightInput) {
      resizeHeightInput.value = String(height);
    }
    showResizePreview(left, top, width, height);
    return;
  }

  if (moving) {
    const layer = store.activeLayer;
    if (layer) {
      const scale = currentScale(img) || 1;
      const dx = (event.clientX - moving.startClientX) / scale;
      const dy = (event.clientY - moving.startClientY) / scale;
      const offsetX = Math.round(moving.offsetX + dx);
      const offsetY = Math.round(moving.offsetY + dy);
      if (offsetX !== layer.offsetX || offsetY !== layer.offsetY) {
        store.layers[store.activeIndex] = { ...layer, offsetX, offsetY };
        drawMovePreview();
        redrawOverlay();
      }
    }
    return;
  }

  if (store.activeTool === 'eyedropper' || ((store.activeTool === 'brush' || store.activeTool === 'bucket') && event.altKey)) {
    showSamplePreview(event.clientX, event.clientY, sampleColorAt(img, point.x, point.y));
  } else {
    hideSamplePreview();
  }
  updateHoverCursor(point.x, point.y);
});

canvas.addEventListener('pointerleave', () => {
  hoverPoint = null;
  hideSamplePreview();
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
  if (strokeImage) {
    // Paint anything still pending, then just refresh the UI: the stroke's
    // pixels were already rendered through the per-stroke damage updates, so
    // there is no need to recomposite the whole document again.
    flushPaintUpdate();
    strokeImage = null;
    strokeSource = null;
    strokeMask = null;
    strokeBase = null;
    store.emit();
  }
  if (selecting) {
    const finished = selecting;
    const base = selectionBase;
    const mode = selectionMode;
    selecting = null;
    selectionBase = null;
    if (finished.type === 'marquee' && !finished.moved) {
      // A plain click with the marquee clears the selection.
      store.clearSelection();
    } else {
      const mask =
        finished.type === 'marquee'
          ? rectSelection(store.width, store.height, finished.startX, finished.startY, finished.currentX, finished.currentY)
          : polygonSelection(store.width, store.height, finished.points);
      store.setSelection(combineSelection(base, mask, mode));
    }
  }
  if (moving) {
    moving = null;
    movePreview = null;
    bakeActiveLayerOffset();
  }
  sampling = false;
  hideSamplePreview();
  transformDrag = null;
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
      if (resizeScaleCheckbox.checked) {
        store.resizeDocument(pending.width, pending.height);
      } else {
        store.resizeCanvas(pending.width, pending.height, pending.left, pending.top);
      }
    }
  }
}

canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);

function forEachStamp(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number,
  fn: (x: number, y: number) => void,
): void {
  const distance = Math.sqrt((toX - fromX) ** 2 + (toY - fromY) ** 2);
  const step = Math.max(0.5, radius / 3);
  const steps = Math.max(1, Math.ceil(distance / step));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    fn(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t);
  }
}

// Strokes mutate pixels immediately but render at most once per animation
// frame: damage rectangles accumulate and flush together, so high-rate pointer
// input never does more rendering work than the display can show.
// Rectangles stay separate (only overlapping ones are merged), so symmetric
// copies far apart do not inflate the repainted area.
let paintDamage: { x0: number; y0: number; x1: number; y1: number }[] = [];
let paintFrame = 0;

function flushPaintUpdate(): void {
  if (paintFrame !== 0) {
    cancelAnimationFrame(paintFrame);
    paintFrame = 0;
  }
  const damage = paintDamage;
  paintDamage = [];
  if (damage.length > 0) {
    store.notifyAreas(
      damage.map((rect) => ({ x: rect.x0, y: rect.y0, width: rect.x1 - rect.x0, height: rect.y1 - rect.y0 })),
    );
  }
}

function schedulePaintUpdate(minX: number, minY: number, maxX: number, maxY: number): void {
  let rect = { x0: minX, y0: minY, x1: maxX, y1: maxY };
  // Union with every overlapping rectangle, repeating until no more overlap
  // (a union can grow into another rectangle).
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < paintDamage.length; i++) {
      const other = paintDamage[i];
      if (rect.x0 <= other.x1 && rect.x1 >= other.x0 && rect.y0 <= other.y1 && rect.y1 >= other.y0) {
        rect = {
          x0: Math.min(rect.x0, other.x0),
          y0: Math.min(rect.y0, other.y0),
          x1: Math.max(rect.x1, other.x1),
          y1: Math.max(rect.y1, other.y1),
        };
        paintDamage.splice(i, 1);
        merged = true;
        break;
      }
    }
  }
  paintDamage.push(rect);
  if (paintFrame === 0) {
    paintFrame = requestAnimationFrame(flushPaintUpdate);
  }
}

function paintStrokeSegment(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  pressure: number,
): void {
  if (!strokeImage) {
    return;
  }
  const layer = store.activeLayer;
  const offsetX = layer ? layer.offsetX : 0;
  const offsetY = layer ? layer.offsetY : 0;
  const brush = store.brush;
  const sizeFactor = pressureFactor(brush.pressure.sizeMin, brush.pressure.sizeCurve, pressure);
  const alphaFactor = pressureFactor(brush.pressure.alphaMin, brush.pressure.alphaCurve, pressure);
  const radius = Math.max(0.5, (store.brushSize / 2) * sizeFactor);
  // Pixel brushes always stamp fully opaque, on/off pixels (pixel art).
  const alpha = brush.pixel ? 1 : clamp(store.brushOpacity * alphaFactor, 0, 1);

  let dirX = toX - fromX;
  let dirY = toY - fromY;
  const segmentLength = Math.hypot(dirX, dirY);
  if (segmentLength > 1e-6) {
    dirX /= segmentLength;
    dirY /= segmentLength;
  } else {
    dirX = 1;
    dirY = 0;
  }

  if (strokeKind === 'clone' && strokeSource) {
    const frame = { dirX, dirY, distance: strokeDistance, seedX: strokeSeedX, seedY: strokeSeedY };
    const source = strokeSource;
    const baseOffsetX = cloneOffset?.x ?? 0;
    const baseOffsetY = cloneOffset?.y ?? 0;
    forEachStrokeTransform((transform) => {
      // The sampled source is mirrored with the stamp, so the clone offset
      // follows the copy's transform.
      const offset = transform
        ? transformDirection(transform, baseOffsetX, baseOffsetY)
        : { x: baseOffsetX, y: baseOffsetY };
      const params = {
        radius,
        alpha,
        brush,
        angle: transform ? transformAngle(transform, brush.angle) : brush.angle,
        frame,
        selection: store.selection,
        layerOffsetX: offsetX,
        layerOffsetY: offsetY,
        cloneOffsetX: offset.x,
        cloneOffsetY: offset.y,
      };
      forEachStamp(fromX, fromY, toX, toY, radius, (x, y) => {
        const sx = transform ? transform.a * x + transform.c * y + transform.e : x;
        const sy = transform ? transform.b * x + transform.d * y + transform.f : y;
        cloneStamp(strokeImage!, source, sx, sy, params);
      });
    });
  } else if (strokeKind === 'heal' && strokeSource) {
    const frame = { dirX, dirY, distance: strokeDistance, seedX: strokeSeedX, seedY: strokeSeedY };
    const source = strokeSource;
    forEachStrokeTransform((transform) => {
      const params = {
        radius,
        alpha,
        brush,
        angle: transform ? transformAngle(transform, brush.angle) : brush.angle,
        frame,
        selection: store.selection,
        layerOffsetX: offsetX,
        layerOffsetY: offsetY,
      };
      forEachStamp(fromX, fromY, toX, toY, radius, (x, y) => {
        const sx = transform ? transform.a * x + transform.c * y + transform.e : x;
        const sy = transform ? transform.b * x + transform.d * y + transform.f : y;
        healStamp(strokeImage!, source, sx, sy, params);
      });
    });
  } else if (strokeKind === 'knife') {
    const frame = { dirX, dirY, distance: strokeDistance, seedX: strokeSeedX, seedY: strokeSeedY };
    forEachStrokeTransform((transform) => {
      // Mirrored copies smear in the mirrored direction.
      const direction = transform ? transformDirection(transform, dirX, dirY) : { x: dirX, y: dirY };
      const params = {
        radius,
        strength: alpha,
        smear: store.knifeSmear,
        brush,
        angle: transform ? transformAngle(transform, brush.angle) : brush.angle,
        frame,
        selection: store.selection,
        layerOffsetX: offsetX,
        layerOffsetY: offsetY,
        dirX: direction.x,
        dirY: direction.y,
      };
      forEachStamp(fromX, fromY, toX, toY, radius, (x, y) => {
        const sx = transform ? transform.a * x + transform.c * y + transform.e : x;
        const sy = transform ? transform.b * x + transform.d * y + transform.f : y;
        knifeStamp(strokeImage!, sx, sy, params);
      });
    });
  } else {
    // Brush / eraser: stamp along the segment, advancing the stroke-space
    // distance so the texture travels with the brush, and jittering the tip.
    const spacing = Math.max(0.5, radius * brush.spacing);
    const steps = Math.max(1, Math.ceil(segmentLength / spacing));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = fromX + (toX - fromX) * t;
      const y = fromY + (toY - fromY) * t;
      const angleOffset =
        brush.rotationJitter > 0
          ? (hash01(strokeJitterSeed + strokeStampIndex * 2654435761) * 2 - 1) * brush.rotationJitter
          : 0;
      strokeStampIndex++;
      const frame = { dirX, dirY, distance: strokeDistance + segmentLength * t, seedX: strokeSeedX, seedY: strokeSeedY };
      forEachStrokeTransform((transform) => {
        const params = {
          radius,
          color: store.foreground,
          alpha,
          selection: store.selection,
          erase: strokeKind === 'eraser',
          brush,
          angle: transform ? transformAngle(transform, brush.angle + angleOffset) : brush.angle + angleOffset,
          frame,
          strokeMask,
          strokeBase,
          offsetX,
          offsetY,
        };
        const sx = transform ? transform.a * x + transform.c * y + transform.e : x;
        const sy = transform ? transform.b * x + transform.d * y + transform.f : y;
        stampBrush(strokeImage!, sx, sy, params);
      });
    }
  }
  strokeDistance += segmentLength;
  // Only the segment's bounding box (expanded by the brush reach) changed, so
  // hand the renderer that damage rectangle instead of a full-document update.
  // With symmetry on, every copy's box is scheduled as damage instead.
  const reach = radius + 1 + (brush.edgeTexture > 0 ? radius * 0.4 : 0);
  const minX = Math.min(fromX, toX) - reach;
  const minY = Math.min(fromY, toY) - reach;
  const maxX = Math.max(fromX, toX) + reach;
  const maxY = Math.max(fromY, toY) + reach;
  if (strokeTransforms) {
    for (const transform of strokeTransforms) {
      let copyMinX = Infinity;
      let copyMinY = Infinity;
      let copyMaxX = -Infinity;
      let copyMaxY = -Infinity;
      for (const [cornerX, cornerY] of [
        [minX, minY],
        [maxX, minY],
        [maxX, maxY],
        [minX, maxY],
      ] as [number, number][]) {
        const tx = transform.a * cornerX + transform.c * cornerY + transform.e;
        const ty = transform.b * cornerX + transform.d * cornerY + transform.f;
        if (tx < copyMinX) copyMinX = tx;
        if (tx > copyMaxX) copyMaxX = tx;
        if (ty < copyMinY) copyMinY = ty;
        if (ty > copyMaxY) copyMaxY = ty;
      }
      schedulePaintUpdate(copyMinX, copyMinY, copyMaxX, copyMaxY);
    }
  } else {
    schedulePaintUpdate(minX, minY, maxX, maxY);
  }
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
      timeline?.togglePlay();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      timeline?.stopPlayback();
      return;
    }
    if (ctrl && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveDocument();
      return;
    }
    return;
  }

  if (textEditing) {
    const editing = textEditing;
    if (ctrl) {
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveDocument();
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
      editing.content = editing.content.slice(0, -1);
      redrawOverlay();
      return;
    }
    if (event.key.length === 1) {
      event.preventDefault();
      editing.content += event.key;
      redrawOverlay();
      return;
    }
    return;
  }

  if (ctrl && event.key.toLowerCase() === 's') {
    // Match the toolbar Save button instead of the browser's "Save page".
    event.preventDefault();
    saveDocument();
    return;
  }
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
  if (ctrl && event.key.toLowerCase() === 'n') {
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
  if (ctrl && event.key.toLowerCase() === 'd') {
    if (typing) {
      return;
    }
    event.preventDefault();
    if (floating) {
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
    if (floating) {
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
      symmetryDrag = null;
      store.setSymmetry({ transformMode: false });
    } else if (floating) {
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
    event.preventDefault();
    if (store.settings.animationMode) {
      timeline?.togglePlay();
    } else {
      spaceHeld = true;
    }
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
    imageSizeText.textContent = `${img.width}x${img.height}`;
  } else {
    imageSizeText.textContent = '';
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
  if (document.activeElement !== textSizeInput) {
    textSizeInput.value = String(store.textSize);
  }
  textFontSelect.value = store.textFont;
  textBoldCheckbox.checked = store.textBold;
  textItalicCheckbox.checked = store.textItalic;
  textSwatch.style.background = `rgb(${store.foreground.r}, ${store.foreground.g}, ${store.foreground.b})`;
  renderPaletteStrip();
  if (document.activeElement !== resizeWidthInput && store.width > 0) {
    resizeWidthInput.value = String(store.width);
    resizeRatio = store.width / Math.max(1, store.height);
  }
  if (document.activeElement !== resizeHeightInput && store.height > 0) {
    resizeHeightInput.value = String(store.height);
  }
  brushSwatch.style.background = `rgb(${store.foreground.r}, ${store.foreground.g}, ${store.foreground.b})`;
  brushSelect.value = store.brushId;
  knifeSelect.value = store.brushId;
  if (document.activeElement !== knifeSizeInput) {
    knifeSizeInput.value = String(store.brushSize);
  }
  if (document.activeElement !== knifeStrengthInput) {
    knifeStrengthInput.value = String(Math.round(store.brushOpacity * 100));
  }
  if (document.activeElement !== knifeSmearInput) {
    knifeSmearInput.value = String(Math.round(store.knifeSmear * 100));
  }

  const tool = store.activeTool;
  const showKnife = tool === 'knife';
  const showBrush = isBrushTool(tool) && !showKnife;
  const showBucket = tool === 'bucket';
  const showWand = tool === 'wand';
  const showZoom = tool === 'zoom';
  const showResize = tool === 'resize';
  const showText = tool === 'text';
  const showPalette = tool === 'brush' || tool === 'bucket' || tool === 'text';
  brushSection.style.display = showBrush ? 'flex' : 'none';
  knifeSection.style.display = showKnife ? 'flex' : 'none';
  bucketSection.style.display = showBucket ? 'flex' : 'none';
  wandSection.style.display = showWand ? 'flex' : 'none';
  zoomSection.style.display = showZoom ? 'flex' : 'none';
  resizeSection.style.display = showResize ? 'flex' : 'none';
  textSection.style.display = showText ? 'flex' : 'none';
  paletteSection.style.display = showPalette ? 'flex' : 'none';
  hintSection.style.display =
    showBrush || showKnife || showBucket || showWand || showZoom || showResize || showText ? 'none' : 'flex';
  hintLabel.textContent = `${tool[0].toUpperCase()+tool.slice(1)}`;

  undoButton.disabled = store.working || (!store.canUndo() && !floating);
  redoButton.disabled = store.working || !store.canRedo() || floating !== null;
  restoreButton.disabled = store.working || store.current === null;
  ditherButton.disabled = store.working;
  paletteButton.disabled = store.working;
  adjustmentsButton.disabled = store.working;
  effectsButton.disabled = store.working;
  modifiersButton.disabled = store.working;
  layersButton.disabled = store.working;
  settingsButton.disabled = store.working;
  openButton.disabled = store.working;
  newButton.disabled = store.working;
  saveButton.disabled = store.working || store.current === null;
  statusText.textContent = store.status;

  syncPanelButtons();
  miniLayers?.sync();
  timeline?.sync();
  // Also runs when there is no image (applyCanvasLayout returns early then),
  // so the minimap hides itself correctly.
  renderMinimap();
}

function prepareFrameChange(): void {
  if (textEditing) {
    commitText();
  }
  if (floating) {
    commitFloating();
  }
}

timeline = createTimeline(ctx, applyCanvasLayout, prepareFrameChange);
app.append(timeline.root);

store.onChange(render);
render();
