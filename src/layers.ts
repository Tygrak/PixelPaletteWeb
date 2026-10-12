// Layer model and compositing (source-over alpha blending).

import { cloneImage, createEmptyImage } from './image';

export interface Layer {
  id: number;
  name: string;
  image: ImageData;
  visible: boolean;
  opacity: number;
  offsetX: number;
  offsetY: number;
}

let nextLayerId = 1;

export function createLayer(width: number, height: number, name: string, image?: ImageData): Layer {
  return {
    id: nextLayerId++,
    name,
    image: image ?? createEmptyImage(width, height),
    visible: true,
    opacity: 1,
    offsetX: 0,
    offsetY: 0,
  };
}

export function cloneLayer(layer: Layer): Layer {
  return { ...layer, image: cloneImage(layer.image) };
}

// Creates a copy of a layer with a fresh id and the given name.
export function duplicateLayer(layer: Layer, name: string): Layer {
  return { ...layer, id: nextLayerId++, name, image: cloneImage(layer.image) };
}

// Shallow copy: shares the underlying ImageData (use when the image will be
// replaced rather than mutated in place).
export function copyLayer(layer: Layer): Layer {
  return { ...layer };
}

export function compositeLayers(layers: Layer[], width: number, height: number): ImageData {
  const visible = layers.filter((layer) => layer.visible && layer.opacity > 0);
  if (visible.length === 0) {
    return createEmptyImage(width, height);
  }
  const single = visible[0];
  if (
    visible.length === 1 &&
    single.offsetX === 0 &&
    single.offsetY === 0 &&
    single.opacity >= 1
  ) {
    return single.image;
  }

  const out = createEmptyImage(width, height);
  const outData = out.data;
  for (const layer of visible) {
    const src = layer.image.data;
    const layerWidth = layer.image.width;
    const layerHeight = layer.image.height;
    const { offsetX, offsetY, opacity } = layer;
    for (let y = 0; y < layerHeight; y++) {
      const destY = y + offsetY;
      if (destY < 0 || destY >= height) {
        continue;
      }
      for (let x = 0; x < layerWidth; x++) {
        const destX = x + offsetX;
        if (destX < 0 || destX >= width) {
          continue;
        }
        const sourcePos = (x + y * layerWidth) * 4;
        const sourceAlpha = (src[sourcePos + 3] / 255) * opacity;
        if (sourceAlpha <= 0) {
          continue;
        }
        const destPos = (destX + destY * width) * 4;
        const destAlpha = outData[destPos + 3] / 255;
        const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
        if (outAlpha <= 0) {
          continue;
        }
        outData[destPos] = Math.round(
          (src[sourcePos] * sourceAlpha + outData[destPos] * destAlpha * (1 - sourceAlpha)) / outAlpha,
        );
        outData[destPos + 1] = Math.round(
          (src[sourcePos + 1] * sourceAlpha + outData[destPos + 1] * destAlpha * (1 - sourceAlpha)) / outAlpha,
        );
        outData[destPos + 2] = Math.round(
          (src[sourcePos + 2] * sourceAlpha + outData[destPos + 2] * destAlpha * (1 - sourceAlpha)) / outAlpha,
        );
        outData[destPos + 3] = Math.round(outAlpha * 255);
      }
    }
  }
  return out;
}

// Recomputes just a document-space rectangle of an existing composite (built
// from the same layers). Painting mutates one layer in place, so only the small
// area a stroke touched needs re-blending instead of the whole document. The
// math mirrors compositeLayers exactly (including its per-layer rounding) so
// patched regions are pixel-identical to a full rebuild.
export function compositeRegion(
  out: ImageData,
  layers: Layer[],
  rectX: number,
  rectY: number,
  rectWidth: number,
  rectHeight: number,
): void {
  const visible = layers.filter((layer) => layer.visible && layer.opacity > 0);
  const x0 = Math.max(0, Math.floor(rectX));
  const y0 = Math.max(0, Math.floor(rectY));
  const x1 = Math.min(out.width, Math.ceil(rectX + rectWidth));
  const y1 = Math.min(out.height, Math.ceil(rectY + rectHeight));
  if (x1 <= x0 || y1 <= y0) {
    return;
  }
  const outData = out.data;
  if (visible.length === 0) {
    for (let y = y0; y < y1; y++) {
      outData.fill(0, (x0 + y * out.width) * 4, (x1 + y * out.width) * 4);
    }
    return;
  }
  // Single opaque layer: the composite cache IS that layer's image, so the
  // region is already up to date.
  const single = visible[0];
  if (visible.length === 1 && single.offsetX === 0 && single.offsetY === 0 && single.opacity >= 1) {
    return;
  }
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const destPos = (x + y * out.width) * 4;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const layer of visible) {
        const layerX = x - layer.offsetX;
        const layerY = y - layer.offsetY;
        if (layerX < 0 || layerX >= layer.image.width || layerY < 0 || layerY >= layer.image.height) {
          continue;
        }
        const src = layer.image.data;
        const sourcePos = (layerX + layerY * layer.image.width) * 4;
        const sourceAlpha = (src[sourcePos + 3] / 255) * layer.opacity;
        if (sourceAlpha <= 0) {
          continue;
        }
        const destAlpha = a / 255;
        const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
        if (outAlpha <= 0) {
          continue;
        }
        r = Math.round((src[sourcePos] * sourceAlpha + r * destAlpha * (1 - sourceAlpha)) / outAlpha);
        g = Math.round((src[sourcePos + 1] * sourceAlpha + g * destAlpha * (1 - sourceAlpha)) / outAlpha);
        b = Math.round((src[sourcePos + 2] * sourceAlpha + b * destAlpha * (1 - sourceAlpha)) / outAlpha);
        a = Math.round(outAlpha * 255);
      }
      outData[destPos] = r;
      outData[destPos + 1] = g;
      outData[destPos + 2] = b;
      outData[destPos + 3] = a;
    }
  }
}
