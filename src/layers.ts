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
