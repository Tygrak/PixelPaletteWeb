import { rgb, RGB } from './color';
import { cloneImage, placeImageCentered, resizeCanvasImage, resizeImage } from './image';
import { compositeLayers, copyLayer, createLayer, duplicateLayer as duplicateLayerData, Layer } from './layers';
import { Selection } from './selection';
import { ToolId } from './tools';

interface Snapshot {
  layers: Layer[];
  activeIndex: number;
}

type Listener = () => void;

// Central editor state: layers, history, tools and selection.
export class Store {
  layers: Layer[] = [];
  activeIndex = 0;
  width = 0;
  height = 0;

  initial: ImageData | null = null;

  palette: RGB[] = [rgb(0, 0, 0), rgb(255, 255, 255)];

  activeTool: ToolId = 'hand';
  foreground: RGB = rgb(0, 0, 0);
  brushSize = 24;
  brushOpacity = 1;
  softBrush = false;
  wandTolerance = 32;
  fillTolerance = 32;

  textSize = 48;
  textFont = 'sans-serif';
  textBold = false;
  textItalic = false;

  selection: Selection | null = null;

  working = false;
  status = '';
  revision = 0;

  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private compositeCache: ImageData | null = null;
  private listeners: Listener[] = [];

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
  }

  // Marks the document as changed (image content / layers).
  notify(): void {
    this.invalidate();
    this.revision++;
    this.emit();
  }

  get activeLayer(): Layer | null {
    return this.layers[this.activeIndex] ?? null;
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

  // --- History ---

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  private snapshot(): Snapshot {
    return { layers: this.layers.map(copyLayer), activeIndex: this.activeIndex };
  }

  private applySnapshot(snapshot: Snapshot): void {
    this.layers = snapshot.layers.map(copyLayer);
    this.activeIndex = snapshot.activeIndex;
    this.selection = null;
  }

  pushHistory(): void {
    if (this.layers.length === 0) {
      return;
    }
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 15) {
      this.undoStack.shift();
    }
    this.redoStack = [];
  }

  undo(): void {
    const snapshot = this.undoStack.pop();
    if (!snapshot) {
      return;
    }
    this.redoStack.push(this.snapshot());
    this.applySnapshot(snapshot);
    this.notify();
  }

  redo(): void {
    const snapshot = this.redoStack.pop();
    if (!snapshot) {
      return;
    }
    this.undoStack.push(this.snapshot());
    this.applySnapshot(snapshot);
    this.notify();
  }

  // --- Document lifecycle ---

  openImage(img: ImageData): void {
    this.width = img.width;
    this.height = img.height;
    this.initial = img;
    this.layers = [createLayer(img.width, img.height, 'Background', cloneImage(img))];
    this.activeIndex = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.selection = null;
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
    this.invalidate();
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

  // Resizes the whole document (every layer) to the given dimensions.
  resizeDocument(width: number, height: number): void {
    if (width < 1 || height < 1 || this.layers.length === 0) {
      return;
    }
    this.pushHistory();
    const scaleX = width / this.width;
    const scaleY = height / this.height;
    this.layers = this.layers.map((layer) => ({
      ...layer,
      image: resizeImage(layer.image, width, height),
      offsetX: Math.round(layer.offsetX * scaleX),
      offsetY: Math.round(layer.offsetY * scaleY),
    }));
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
    this.pushHistory();
    this.layers = this.layers.map((layer) => ({
      ...layer,
      image: resizeCanvasImage(layer.image, width, height, left, top),
    }));
    this.width = width;
    this.height = height;
    this.selection = null;
    this.notify();
  }

  restore(): void {
    if (!this.initial) {
      return;
    }
    this.pushHistory();
    this.width = this.initial.width;
    this.height = this.initial.height;
    this.layers = [createLayer(this.width, this.height, 'Background', cloneImage(this.initial))];
    this.activeIndex = 0;
    this.selection = null;
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

  setSoftBrush(soft: boolean): void {
    this.softBrush = soft;
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

  setStatus(status: string): void {
    this.status = status;
    this.emit();
  }
}
