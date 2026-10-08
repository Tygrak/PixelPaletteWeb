import './style.css';
import { clamp, colorToHex } from './color';
import { AppContext } from './context';
import { DockPanel, h } from './dom';
import { imageDataFromBlob, loadImageFile, saveImageFile } from './files';
import { getPixel } from './image';
import { Store } from './store';
import { openAdjustmentsPanel } from './ui/adjustmentsPanel';
import { openDitherPanel } from './ui/ditherPanel';
import { openEffectsPanel } from './ui/effectsPanel';
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

// --- Layout (created before ctx so panels can dock into it) ---

const canvas = h('canvas', { class: 'main-canvas' });
const canvasPlaceholder = h('div', {
  class: 'placeholder',
  text: 'Open an image to begin, or press Ctrl+V to paste one',
});
const canvasArea = h('div', { class: 'canvas-area' }, [canvas, canvasPlaceholder]);
const dock = h('div', { class: 'dock hidden' });
const dockResizer = h('div', { class: 'dock-resizer' });

const imageSizeText = h('span', { class: 'image-size' });
const statusText = h('span', { class: 'status' });

const ctx: AppContext = {
  store,
  dock,
  selectColor: (initial) => selectColorDialog(initial),
  applyImage: (img) => store.changeMainImage(img),
  runTask: async (status, task) => {
    store.working = true;
    store.setStatus(status);
    // Yield so the status paints before the (synchronous) heavy work begins.
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
};

// --- Toolbar / sidebar ---

const openButton = h('button', {
  class: 'btn toolbar-btn',
  text: 'Open File',
  onclick: async () => {
    if (store.working) {
      return;
    }
    const image = await loadImageFile();
    if (image) {
      store.openImage(image);
    }
  },
});
const saveButton = h('button', {
  class: 'btn toolbar-btn',
  text: 'Save File',
  onclick: () => {
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
      store.undo();
    }
  },
});
const redoButton = h('button', {
  class: 'btn toolbar-btn',
  text: 'Redo',
  onclick: () => {
    if (!store.working) {
      store.redo();
    }
  },
});
const restoreButton = h('button', {
  class: 'btn',
  text: 'Restore',
  onclick: () => {
    if (!store.working) {
      store.restore();
    }
  },
});
const ditherButton = h('button', {
  class: 'btn sidebar-btn',
  text: 'Dither',
  onclick: () => togglePanels.dither(),
});
const paletteButton = h('button', {
  class: 'btn sidebar-btn',
  text: 'Palette',
  onclick: () => togglePanels.palette(),
});
const adjustmentsButton = h('button', {
  class: 'btn sidebar-btn',
  text: 'Adjustments',
  onclick: () => togglePanels.adjustments(),
});
const effectsButton = h('button', {
  class: 'btn sidebar-btn',
  text: 'Effects',
  onclick: () => togglePanels.effects(),
});

const toolbar = h('div', { class: 'toolbar' }, [
  openButton,
  saveButton,
  undoButton,
  redoButton,
  h('div', { class: 'spacer' }),
  imageSizeText,
  statusText,
]);

const sidebar = h('div', { class: 'sidebar' }, [
  restoreButton,
  ditherButton,
  paletteButton,
  adjustmentsButton,
  effectsButton,
]);
const main = h('div', { class: 'main' }, [sidebar, dock, dockResizer, canvasArea]);
const app = h('div', { class: 'app' }, [toolbar, main]);

document.querySelector('#app')!.append(app);

// --- Zoom / pan state ---

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 40;
const ZOOM_STEP = 1.1;

let zoom = 1; // relative to the fit-to-area scale (1 = fitted)
let offsetX = 0;
let offsetY = 0;

function fitScale(img: ImageData): number {
  const area = canvasArea.getBoundingClientRect();
  return Math.min(1, area.width / img.width, area.height / img.height);
}

function currentScale(img: ImageData): number {
  return fitScale(img) * zoom;
}

function canPan(img: ImageData, scale: number): boolean {
  const area = canvasArea.getBoundingClientRect();
  return img.width * scale > area.width + 0.5 || img.height * scale > area.height + 0.5;
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
  canvas.style.width = `${displayedWidth}px`;
  canvas.style.height = `${displayedHeight}px`;
  canvas.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
}

canvasArea.addEventListener(
  'wheel',
  (event) => {
    if (!store.current) {
      return;
    }
    const img = store.current;

    // Ctrl/Cmd + wheel: zoom towards the cursor.
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return;
      }
      const area = canvasArea.getBoundingClientRect();
      const areaCenterX = area.left + area.width / 2;
      const areaCenterY = area.top + area.height / 2;
      const relX = (event.clientX - rect.left) / rect.width;
      const relY = (event.clientY - rect.top) / rect.height;

      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      zoom = clamp(zoom * factor, MIN_ZOOM, MAX_ZOOM);
      const scale = currentScale(img);
      const displayedWidth = img.width * scale;
      const displayedHeight = img.height * scale;
      // Keep the image point under the cursor stationary while zooming.
      offsetX = event.clientX - relX * displayedWidth - areaCenterX + displayedWidth / 2;
      offsetY = event.clientY - relY * displayedHeight - areaCenterY + displayedHeight / 2;
      applyCanvasLayout();
      return;
    }

    // Shift + wheel: pan horizontally. Plain wheel: pan vertically.
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

let dragging = false;
let dragMoved = false;
let lastPointerX = 0;
let lastPointerY = 0;

canvas.addEventListener('pointerdown', (event) => {
  if (!store.current || event.button !== 0) {
    return;
  }
  const scale = currentScale(store.current);
  if (!canPan(store.current, scale)) {
    return;
  }
  dragging = true;
  dragMoved = false;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
  canvas.style.cursor = 'grabbing';
});

canvas.addEventListener('pointermove', (event) => {
  if (!dragging) {
    return;
  }
  const dx = event.clientX - lastPointerX;
  const dy = event.clientY - lastPointerY;
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  offsetX += dx;
  offsetY += dy;
  if (Math.abs(dx) + Math.abs(dy) > 1) {
    dragMoved = true;
  }
  applyCanvasLayout();
});

const endDrag = (event: PointerEvent): void => {
  if (!dragging) {
    return;
  }
  dragging = false;
  canvas.releasePointerCapture(event.pointerId);
  canvas.style.cursor = '';
};

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

canvas.addEventListener('click', (event) => {
  if (!store.current || dragMoved) {
    dragMoved = false;
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const x = Math.min(
    store.current.width - 1,
    Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * store.current.width)),
  );
  const y = Math.min(
    store.current.height - 1,
    Math.max(0, Math.floor(((event.clientY - rect.top) / rect.height) * store.current.height)),
  );
  const color = getPixel(store.current, x, y);
  const colorPicker = getActiveColorPicker();
  if (colorPicker) {
    colorPicker(color);
    return;
  }
  void copyText(colorToHex(color));
});

// --- Clipboard paste ---

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
    if (image) {
      store.openImage(image);
    }
  });
});

window.addEventListener('resize', () => applyCanvasLayout());

// --- Rendering / state sync ---

let drawnImage: ImageData | null = null;
let lastWidth = 0;
let lastHeight = 0;

function render(): void {
  if (store.current && store.current !== drawnImage) {
    const dimensionsChanged = store.current.width !== lastWidth || store.current.height !== lastHeight;
    drawnImage = store.current;
    lastWidth = store.current.width;
    lastHeight = store.current.height;
    if (dimensionsChanged) {
      zoom = 1;
      offsetX = 0;
      offsetY = 0;
    }
    canvas.width = store.current.width;
    canvas.height = store.current.height;
    canvas.getContext('2d')!.putImageData(store.current, 0, 0);
    canvas.classList.add('visible');
    canvasPlaceholder.classList.add('hidden');
    imageSizeText.textContent = `${store.current.width}x${store.current.height}`;
  }
  if (!store.current) {
    imageSizeText.textContent = '';
    canvas.classList.remove('visible');
    canvasPlaceholder.classList.remove('hidden');
  }
  applyCanvasLayout();

  undoButton.disabled = store.working || !store.canUndo();
  redoButton.disabled = store.working || !store.canRedo();
  restoreButton.disabled = store.working || store.current === null;
  ditherButton.disabled = store.working;
  paletteButton.disabled = store.working;
  adjustmentsButton.disabled = store.working;
  effectsButton.disabled = store.working;
  openButton.disabled = store.working;
  saveButton.disabled = store.working || store.current === null;
  statusText.textContent = store.status;
}

store.onChange(render);
render();
