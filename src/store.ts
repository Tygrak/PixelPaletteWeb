import { brushById } from './brushLibrary';
import { Brush, DEFAULT_BRUSH_ID } from './brushes';
import { rgb, RGB } from './color';
import { cloneImage, createEmptyImage, fillImage, placeImageCentered, resizeCanvasImage, resizeImage } from './image';
import {
  compositeLayers,
  compositeRegion,
  copyLayer,
  createLayer,
  duplicateLayer as duplicateLayerData,
  Layer,
} from './layers';
import { SymmetryState } from './modifiers';
import { Selection } from './selection';
import { loadSettings, saveSettings, Settings } from './settings';
import { ToolId } from './tools';

interface Snapshot {
  layers: Layer[];
  activeIndex: number;
  width: number;
  height: number;
}

// One animation frame: an independent document (its layers + active layer)
// with its own undo history, so switching frames preserves per-frame editing.
export interface Frame {
  id: number;
  layers: Layer[];
  activeIndex: number;
  // Bumped whenever this frame's content changes, so views such as the onion
  // skin can cache a frame's composite without recompositing every render.
  contentRevision: number;
  undo: Snapshot[];
  redo: Snapshot[];
}

let nextFrameId = 1;

function makeFrame(): Frame {
  return { id: nextFrameId++, layers: [], activeIndex: 0, contentRevision: 0, undo: [], redo: [] };
}

type Listener = () => void;

export interface DamageRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const HISTORY_LIMIT = 15;

// Central editor state: frames, history, tools and selection.
export class Store {
  // The document is a list of frames; the current frame's layers are the live
  // ones. Even without animation there is always a single frame.
  private frames: Frame[] = [makeFrame()];
  currentFrame = 0;

  width = 0;
  height = 0;

  initial: ImageData | null = null;

  palette: RGB[] = [rgb(0, 0, 0), rgb(255, 255, 255)];

  settings: Settings = loadSettings();

  activeTool: ToolId = 'hand';
  foreground: RGB = rgb(0, 0, 0);
  brushSize = 24;
  brushOpacity = 1;
  brushId = DEFAULT_BRUSH_ID;
  knifeSmear = 0.6;
  wandTolerance = 32;
  fillTolerance = 32;

  // Drawing modifiers: the symmetry guide is shared across frames and tools.
  symmetry: SymmetryState = {
    enabled: false,
    mode: 'mirror',
    cx: 0,
    cy: 0,
    angle: Math.PI / 2,
    length: 0,
    segments: 2,
    transformMode: false,
  };

  textSize = 48;
  textFont = 'sans-serif';
  textBold = false;
  textItalic = false;

  selection: Selection | null = null;

  working = false;
  playing = false;
  status = '';
  revision = 0;

  // When the last change was local (paint strokes), the document-space
  // rectangles it touched; null means the whole canvas needs repainting.
  // Several rectangles are kept (instead of one union) so symmetric strokes
  // far from the guide center do not inflate the repainted area.
  lastDamage: DamageRect[] | null = null;

  private compositeCache: ImageData | null = null;
  private listeners: Listener[] = [];

  // Live document, backed by the current frame.
  get layers(): Layer[] {
    return this.frames[this.currentFrame].layers;
  }

  set layers(value: Layer[]) {
    this.frames[this.currentFrame].layers = value;
  }

  get activeIndex(): number {
    return this.frames[this.currentFrame].activeIndex;
  }

  set activeIndex(value: number) {
    this.frames[this.currentFrame].activeIndex = value;
  }

  onChange(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private invalidate(): void {
    this.compositeCache = null;
    // Any full invalidation also invalidates the pending damage rectangle, so
    // a stale rectangle can never cause a partial repaint of new content.
    this.lastDamage = null;
  }

  // Marks the document as changed (image content / layers).
  notify(): void {
    this.invalidate();
    this.lastDamage = null;
    this.revision++;
    this.frames[this.currentFrame].contentRevision++;
    this.emit();
  }

  // Fast path for local edits (brush strokes): only the given document-space
  // rectangles changed, so the cached composite is patched in place and the
  // renderer can update just those parts of the canvas. All rectangles are
  // patched and rendered together, in a single emit.
  notifyAreas(rects: DamageRect[]): void {
    if (this.layers.length === 0 || this.width === 0 || this.height === 0) {
      return;
    }
    const clamped: DamageRect[] = [];
    for (const rect of rects) {
      const x0 = Math.max(0, Math.floor(rect.x));
      const y0 = Math.max(0, Math.floor(rect.y));
      const x1 = Math.min(this.width, Math.ceil(rect.x + rect.width));
      const y1 = Math.min(this.height, Math.ceil(rect.y + rect.height));
      if (x1 <= x0 || y1 <= y0) {
        continue;
      }
      clamped.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
    }
    if (clamped.length === 0) {
      return;
    }
    if (this.compositeCache !== null) {
      for (const rect of clamped) {
        compositeRegion(this.compositeCache, this.layers, rect.x, rect.y, rect.width, rect.height);
      }
      this.lastDamage = clamped;
    } else {
      // No cached composite yet; the next render rebuilds it in full.
      this.lastDamage = null;
    }
    this.revision++;
    this.frames[this.currentFrame].contentRevision++;
    this.emit();
  }

  notifyArea(x: number, y: number, width: number, height: number): void {
    this.notifyAreas([{ x, y, width, height }]);
  }

  get activeLayer(): Layer | null {
    return this.layers[this.activeIndex] ?? null;
  }

  // The active layer's own pixels (processing operations act on this, not the
  // flattened composite, so they affect only the current layer).
  get activeImage(): ImageData | null {
    return this.activeLayer?.image ?? null;
  }

  // The flattened document that is displayed and processed.
  get current(): ImageData | null {
    if (this.layers.length === 0) {
      return null;
    }
    if (this.compositeCache === null) {
      this.compositeCache = compositeLayers(this.layers, this.width, this.height);
    }
    return this.compositeCache;
  }

  // --- History (per frame) ---

  canUndo(): boolean {
    return this.frames[this.currentFrame].undo.length > 0;
  }

  canRedo(): boolean {
    return this.frames[this.currentFrame].redo.length > 0;
  }

  private snapshot(): Snapshot {
    return {
      layers: this.layers.map(copyLayer),
      activeIndex: this.activeIndex,
      width: this.width,
      height: this.height,
    };
  }

  private applySnapshot(snapshot: Snapshot): void {
    this.layers = snapshot.layers.map(copyLayer);
    this.activeIndex = snapshot.activeIndex;
    this.width = snapshot.width;
    this.height = snapshot.height;
    this.selection = null;
  }

  private clearAllHistory(): void {
    for (const frame of this.frames) {
      frame.undo = [];
      frame.redo = [];
    }
  }

  // Re-centers the symmetry guide on a freshly opened document.
  private recenterSymmetry(): void {
    if (this.width <= 0 || this.height <= 0) {
      return;
    }
    this.symmetry = {
      ...this.symmetry,
      cx: this.width / 2,
      cy: this.height / 2,
      length: Math.max(this.width, this.height),
    };
  }

  pushHistory(): void {
    if (this.layers.length === 0) {
      return;
    }
    const frame = this.frames[this.currentFrame];
    frame.undo.push(this.snapshot());
    if (frame.undo.length > HISTORY_LIMIT) {
      frame.undo.shift();
    }
    frame.redo = [];
  }

  undo(): void {
    const frame = this.frames[this.currentFrame];
    const snapshot = frame.undo.pop();
    if (!snapshot) {
      return;
    }
    frame.redo.push(this.snapshot());
    this.applySnapshot(snapshot);
    this.notify();
  }

  redo(): void {
    const frame = this.frames[this.currentFrame];
    const snapshot = frame.redo.pop();
    if (!snapshot) {
      return;
    }
    frame.undo.push(this.snapshot());
    this.applySnapshot(snapshot);
    this.notify();
  }

  // --- Document lifecycle ---

  openImage(img: ImageData): void {
    this.width = img.width;
    this.height = img.height;
    this.initial = img;
    const frame = makeFrame();
    frame.layers = [createLayer(img.width, img.height, 'Background', cloneImage(img))];
    frame.activeIndex = 0;
    this.frames = [frame];
    this.currentFrame = 0;
    this.selection = null;
    this.recenterSymmetry();
    this.notify();
  }

  // Creates a fresh blank document. When `background` is given, an opaque
  // "Background" layer is added with a blank "Layer 1" above it (which becomes
  // the active layer); otherwise the document starts with only "Layer 1".
  newDocument(width: number, height: number, background: RGB | null): void {
    this.width = width;
    this.height = height;
    const frame = makeFrame();
    if (background) {
      const backgroundImage = fillImage(width, height, background);
      this.initial = cloneImage(backgroundImage);
      frame.layers = [
        createLayer(width, height, 'Background', backgroundImage),
        createLayer(width, height, 'Layer 1'),
      ];
      frame.activeIndex = 1;
    } else {
      this.initial = createEmptyImage(width, height);
      frame.layers = [createLayer(width, height, 'Layer 1')];
      frame.activeIndex = 0;
    }
    this.frames = [frame];
    this.currentFrame = 0;
    this.selection = null;
    this.recenterSymmetry();
    this.notify();
  }

  // Used by the processing panels: replaces the active layer's content.
  changeMainImage(img: ImageData): void {
    const layer = this.activeLayer;
    if (!layer) {
      return;
    }
    this.pushHistory();
    this.layers[this.activeIndex] = { ...layer, image: img };
    // When the document is a single layer, keep the canvas in sync with it
    // (e.g. after rotating or resizing the layer).
    if (this.layers.length === 1 && (img.width !== this.width || img.height !== this.height)) {
      this.width = img.width;
      this.height = img.height;
      this.selection = null;
    }
    this.notify();
  }

  // Prepares the active layer for in-place painting: records history and
  // clones the image so the recorded state stays intact.
  beginPaint(): ImageData | null {
    const layer = this.activeLayer;
    if (!layer) {
      return null;
    }
    this.pushHistory();
    const painted = { ...layer, image: cloneImage(layer.image) };
    this.layers[this.activeIndex] = painted;
    // The clone is pixel-identical to the old image, so the cached composite
    // stays valid; paint updates patch the touched regions from the clone.
    // When the cache is the layer's own image (single-layer fast path), point
    // it at the clone so those patches land on the object that is displayed.
    if (this.compositeCache === layer.image) {
      this.compositeCache = painted.image;
    }
    this.lastDamage = null;
    return painted.image;
  }

  // Adds a pasted image as a new layer (centered on the document).
  addImageLayer(source: ImageData): void {
    if (this.width === 0 || this.height === 0) {
      this.openImage(source);
      return;
    }
    this.pushHistory();
    const placed = placeImageCentered(this.width, this.height, source);
    const layer = createLayer(this.width, this.height, 'Pasted', placed);
    this.layers.splice(this.activeIndex + 1, 0, layer);
    this.activeIndex += 1;
    this.notify();
  }

  // History handling for a resize. With a single frame the resize stays
  // undoable; with multiple frames the per-frame snapshots cannot describe the
  // other frames, so history is cleared instead.
  private prepareResize(): void {
    if (this.frames.length > 1) {
      this.clearAllHistory();
    } else {
      this.pushHistory();
    }
  }

  // Resizes the whole document (every frame) to the given dimensions.
  resizeDocument(width: number, height: number): void {
    if (width < 1 || height < 1 || this.layers.length === 0) {
      return;
    }
    this.prepareResize();
    const scaleX = width / this.width;
    const scaleY = height / this.height;
    for (const frame of this.frames) {
      frame.layers = frame.layers.map((layer) => ({
        ...layer,
        image: resizeImage(layer.image, width, height),
        offsetX: Math.round(layer.offsetX * scaleX),
        offsetY: Math.round(layer.offsetY * scaleY),
      }));
      frame.contentRevision++;
    }
    this.width = width;
    this.height = height;
    this.selection = null;
    this.notify();
  }

  // Resizes the canvas without scaling content. The original image is placed
  // at (left, top); new area is filled with the neighboring (edge) color.
  resizeCanvas(width: number, height: number, left: number, top: number): void {
    if (width < 1 || height < 1 || this.layers.length === 0) {
      return;
    }
    this.prepareResize();
    for (const frame of this.frames) {
      frame.layers = frame.layers.map((layer) => ({
        ...layer,
        image: resizeCanvasImage(layer.image, width, height, left, top),
      }));
      frame.contentRevision++;
    }
    this.width = width;
    this.height = height;
    this.selection = null;
    this.notify();
  }

  restore(): void {
    if (!this.initial) {
      return;
    }
    this.width = this.initial.width;
    this.height = this.initial.height;
    const frame = makeFrame();
    frame.layers = [createLayer(this.width, this.height, 'Background', cloneImage(this.initial))];
    frame.activeIndex = 0;
    this.frames = [frame];
    this.currentFrame = 0;
    this.selection = null;
    this.recenterSymmetry();
    this.notify();
  }

  // --- Layers ---

  addLayer(): void {
    if (this.width === 0 || this.height === 0) {
      return;
    }
    this.pushHistory();
    const layer = createLayer(this.width, this.height, `Layer ${this.layers.length + 1}`);
    this.layers.splice(this.activeIndex + 1, 0, layer);
    this.activeIndex += 1;
    this.notify();
  }

  duplicateLayer(): void {
    const layer = this.activeLayer;
    if (!layer) {
      return;
    }
    this.pushHistory();
    const copy = duplicateLayerData(layer, `${layer.name} copy`);
    this.layers.splice(this.activeIndex + 1, 0, copy);
    this.activeIndex += 1;
    this.notify();
  }

  // Merges the active layer down into the layer beneath it.
  mergeLayers(): void {
    if (this.layers.length < 2 || this.activeIndex === 0) {
      return;
    }
    const upperIndex = this.activeIndex;
    const lowerIndex = this.activeIndex - 1;
    this.pushHistory();
    const lower = this.layers[lowerIndex];
    const upper = this.layers[upperIndex];
    const merged = compositeLayers([lower, upper], this.width, this.height);
    const mergedLayer: Layer = {
      ...lower,
      image: merged,
      visible: true,
      opacity: 1,
      offsetX: 0,
      offsetY: 0,
    };
    this.layers.splice(lowerIndex, 2, mergedLayer);
    this.activeIndex = lowerIndex;
    this.selection = null;
    this.notify();
  }

  deleteLayer(): void {
    if (this.layers.length < 2) {
      return;
    }
    this.pushHistory();
    this.layers.splice(this.activeIndex, 1);
    this.activeIndex = Math.min(this.activeIndex, this.layers.length - 1);
    this.notify();
  }

  setActiveLayer(index: number): void {
    if (index < 0 || index >= this.layers.length) {
      return;
    }
    this.activeIndex = index;
    this.emit();
  }

  setLayerVisible(index: number, visible: boolean): void {
    const layer = this.layers[index];
    if (!layer) {
      return;
    }
    this.layers[index] = { ...layer, visible };
    this.notify();
  }

  renameLayer(index: number, name: string): void {
    const layer = this.layers[index];
    if (!layer || layer.name === name || name.trim() === '') {
      return;
    }
    this.pushHistory();
    this.layers[index] = { ...layer, name };
    this.emit();
  }

  // Reorders layers from a bottom-to-top list of layer ids.
  reorderLayers(orderIds: number[]): void {
    if (orderIds.length !== this.layers.length) {
      return;
    }
    const byId = new Map(this.layers.map((layer) => [layer.id, layer]));
    const reordered = orderIds
      .map((id) => byId.get(id))
      .filter((layer): layer is Layer => layer !== undefined);
    if (reordered.length !== this.layers.length) {
      return;
    }
    const activeId = this.layers[this.activeIndex]?.id;
    this.pushHistory();
    this.layers = reordered;
    const newActive = this.layers.findIndex((layer) => layer.id === activeId);
    this.activeIndex = newActive >= 0 ? newActive : 0;
    this.notify();
  }

  // --- Frames / animation ---

  get frameCount(): number {
    return this.frames.length;
  }

  frameId(index: number): number {
    return this.frames[index]?.id ?? -1;
  }

  frameRevision(index: number): number {
    return this.frames[index]?.contentRevision ?? -1;
  }

  // Flattened image of any frame (for thumbnails and export).
  frameComposite(index: number): ImageData | null {
    const frame = this.frames[index];
    if (!frame || frame.layers.length === 0) {
      return null;
    }
    return compositeLayers(frame.layers, this.width, this.height);
  }

  // Switches the edited frame.
  selectFrame(index: number): void {
    if (index < 0 || index >= this.frames.length || index === this.currentFrame) {
      return;
    }
    this.currentFrame = index;
    this.selection = null;
    this.invalidate();
    this.notify();
  }

  // Lightweight frame switch used during playback (keeps the selection).
  previewFrame(index: number): void {
    if (index < 0 || index >= this.frames.length || index === this.currentFrame) {
      return;
    }
    this.currentFrame = index;
    this.invalidate();
    this.revision++;
    this.emit();
  }

  // Adds a frame after the current one. By default it duplicates the current
  // frame's layers; otherwise it starts blank.
  addFrame(duplicate: boolean): void {
    const frame = makeFrame();
    if (duplicate) {
      const source = this.frames[this.currentFrame];
      frame.layers = source.layers.map((layer) => ({ ...layer, image: cloneImage(layer.image) }));
      frame.activeIndex = Math.min(source.activeIndex, Math.max(0, frame.layers.length - 1));
    } else if (this.width > 0 && this.height > 0) {
      frame.layers = [createLayer(this.width, this.height, 'Layer 1')];
      frame.activeIndex = 0;
    }
    const at = this.currentFrame + 1;
    this.frames.splice(at, 0, frame);
    this.currentFrame = at;
    this.selection = null;
    this.invalidate();
    this.notify();
  }

  deleteFrame(index: number): void {
    if (this.frames.length <= 1 || index < 0 || index >= this.frames.length) {
      return;
    }
    this.frames.splice(index, 1);
    if (index < this.currentFrame) {
      this.currentFrame -= 1;
    }
    if (this.currentFrame >= this.frames.length) {
      this.currentFrame = this.frames.length - 1;
    }
    this.selection = null;
    this.invalidate();
    this.notify();
  }

  moveFrame(from: number, to: number): void {
    if (from < 0 || from >= this.frames.length) {
      return;
    }
    const target = Math.max(0, Math.min(this.frames.length - 1, to));
    if (from === target) {
      return;
    }
    const [frame] = this.frames.splice(from, 1);
    this.frames.splice(target, 0, frame);
    this.currentFrame = target;
    this.invalidate();
    this.notify();
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.emit();
  }

  // --- Tool state ---

  setActiveTool(tool: ToolId): void {
    this.activeTool = tool;
    this.emit();
  }

  setForeground(color: RGB): void {
    this.foreground = color;
    this.emit();
  }

  setBrushSize(size: number): void {
    this.brushSize = size;
    this.emit();
  }

  setBrushOpacity(opacity: number): void {
    this.brushOpacity = opacity;
    this.emit();
  }

  // The active brush tip (shape, falloff, texture) selected from the brush
  // library (built-in defaults plus user edits and custom brushes).
  get brush(): Brush {
    return brushById(this.brushId);
  }

  setBrush(brushId: string): void {
    this.brushId = brushId;
    this.emit();
  }

  setKnifeSmear(smear: number): void {
    this.knifeSmear = smear;
    this.emit();
  }

  setWandTolerance(tolerance: number): void {
    this.wandTolerance = tolerance;
    this.emit();
  }

  setFillTolerance(tolerance: number): void {
    this.fillTolerance = tolerance;
    this.emit();
  }

  setSymmetry(patch: Partial<SymmetryState>): void {
    this.symmetry = { ...this.symmetry, ...patch };
    this.emit();
  }

  setTextSize(size: number): void {
    this.textSize = size;
    this.emit();
  }

  setTextFont(font: string): void {
    this.textFont = font;
    this.emit();
  }

  setTextBold(bold: boolean): void {
    this.textBold = bold;
    this.emit();
  }

  setTextItalic(italic: boolean): void {
    this.textItalic = italic;
    this.emit();
  }

  setSelection(mask: Selection | null): void {
    this.selection = mask;
    this.emit();
  }

  clearSelection(): void {
    this.selection = null;
    this.emit();
  }

  // Clears the selected pixels of the active layer to transparency.
  deleteSelection(): void {
    if (!this.selection) {
      return;
    }
    const image = this.beginPaint();
    if (!image) {
      return;
    }
    const layer = this.layers[this.activeIndex];
    const { width, height, data } = image;
    const offsetX = layer.offsetX;
    const offsetY = layer.offsetY;
    for (let i = 0; i < this.selection.length; i++) {
      if (!this.selection[i]) {
        continue;
      }
      const docX = i % width;
      const docY = (i / width) | 0;
      const layerX = docX - offsetX;
      const layerY = docY - offsetY;
      if (layerX < 0 || layerX >= width || layerY < 0 || layerY >= height) {
        continue;
      }
      const pos = (layerX + layerY * width) * 4;
      data[pos] = 0;
      data[pos + 1] = 0;
      data[pos + 2] = 0;
      data[pos + 3] = 0;
    }
    this.notify();
  }

  setStatus(status: string): void {
    this.status = status;
    this.emit();
  }

  updateSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    saveSettings(this.settings);
    this.emit();
  }
}
