// Port of PixelPalette/Algorithm/BitmapConvert.cs and DirectBitmap.cs,
// backed by the browser's ImageData (RGBA, row-major, x + y * width).

import { getBrightness, getDistance, RGB } from './color';

export function createEmptyImage(width: number, height: number): ImageData {
  return new ImageData(width, height);
}

// Creates an opaque image filled with a single color.
export function fillImage(width: number, height: number, color: RGB): ImageData {
  const img = createEmptyImage(width, height);
  const data = img.data;
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = color.r;
    data[i * 4 + 1] = color.g;
    data[i * 4 + 2] = color.b;
    data[i * 4 + 3] = 255;
  }
  return img;
}

export function setPixel(img: ImageData, x: number, y: number, color: RGB): void {
  const index = (x + y * img.width) * 4;
  img.data[index] = color.r;
  img.data[index + 1] = color.g;
  img.data[index + 2] = color.b;
  img.data[index + 3] = 255;
}

export function getPixel(img: ImageData, x: number, y: number): RGB {
  const index = (x + y * img.width) * 4;
  return { r: img.data[index], g: img.data[index + 1], b: img.data[index + 2] };
}

export function colorArrayFromImage(img: ImageData): RGB[] {
  const count = img.width * img.height;
  const colors: RGB[] = new Array(count);
  for (let i = 0; i < count; i++) {
    colors[i] = {
      r: img.data[i * 4],
      g: img.data[i * 4 + 1],
      b: img.data[i * 4 + 2],
    };
  }
  return colors;
}

// Same as ColorArrayFromBitmap, but the values are treated as an unbounded,
// mutable working buffer (mirrors BitmapConvert.IntArrayFromBitmap).
export function intArrayFromImage(img: ImageData): RGB[] {
  return colorArrayFromImage(img);
}

export function imageFromColorArray(width: number, height: number, colors: RGB[]): ImageData {
  const result = createEmptyImage(width, height);
  for (let i = 0; i < colors.length; i++) {
    const index = i * 4;
    result.data[index] = colors[i].r;
    result.data[index + 1] = colors[i].g;
    result.data[index + 2] = colors[i].b;
    result.data[index + 3] = 255;
  }
  return result;
}

export function cloneImage(img: ImageData): ImageData {
  const result = createEmptyImage(img.width, img.height);
  result.data.set(img.data);
  return result;
}

// Returns a copy of the image shifted by (offsetX, offsetY); pixels moved off
// the canvas are dropped and vacated areas become transparent.
export function offsetImage(source: ImageData, offsetX: number, offsetY: number): ImageData {
  const out = createEmptyImage(source.width, source.height);
  for (let y = 0; y < source.height; y++) {
    const sourceY = y - offsetY;
    if (sourceY < 0 || sourceY >= source.height) {
      continue;
    }
    for (let x = 0; x < source.width; x++) {
      const sourceX = x - offsetX;
      if (sourceX < 0 || sourceX >= source.width) {
        continue;
      }
      const sourcePos = (sourceX + sourceY * source.width) * 4;
      const destPos = (x + y * source.width) * 4;
      out.data[destPos] = source.data[sourcePos];
      out.data[destPos + 1] = source.data[sourcePos + 1];
      out.data[destPos + 2] = source.data[sourcePos + 2];
      out.data[destPos + 3] = source.data[sourcePos + 3];
    }
  }
  return out;
}

// Places a source image in the center of a (width x height) transparent image.
export function placeImageCentered(width: number, height: number, source: ImageData): ImageData {
  const out = createEmptyImage(width, height);
  const offsetX = Math.floor((width - source.width) / 2);
  const offsetY = Math.floor((height - source.height) / 2);
  for (let y = 0; y < source.height; y++) {
    const destY = y + offsetY;
    if (destY < 0 || destY >= height) {
      continue;
    }
    for (let x = 0; x < source.width; x++) {
      const destX = x + offsetX;
      if (destX < 0 || destX >= width) {
        continue;
      }
      const sourcePos = (x + y * source.width) * 4;
      const destPos = (destX + destY * width) * 4;
      out.data[destPos] = source.data[sourcePos];
      out.data[destPos + 1] = source.data[sourcePos + 1];
      out.data[destPos + 2] = source.data[sourcePos + 2];
      out.data[destPos + 3] = source.data[sourcePos + 3];
    }
  }
  return out;
}

export function calculateAverageError(a: ImageData, b: ImageData): number {
  const aColors = colorArrayFromImage(a);
  const bColors = colorArrayFromImage(b);
  let error = 0;
  for (let i = 0; i < aColors.length; i++) {
    error += getDistance(aColors[i], bColors[i]);
  }
  return error / aColors.length;
}

export function calculateAverageBrightnessError(a: ImageData, b: ImageData): number {
  const aColors = colorArrayFromImage(a);
  const bColors = colorArrayFromImage(b);
  let error = 0;
  for (let i = 0; i < aColors.length; i++) {
    error += getBrightness(aColors[i]) - getBrightness(bColors[i]);
  }
  return error / aColors.length;
}

// --- Canvas-backed bitmap transforms (resize / rotate / flip) ---

function imageToCanvas(img: ImageData): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  return canvas;
}

export function resizeImage(img: ImageData, width: number, height: number): ImageData {
  const source = imageToCanvas(img);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height);
}

// Resizes the canvas without scaling the content: the original image is placed
// at (left, top) in the new canvas. Areas outside the source are filled with
// the nearest edge color (replicate), and areas outside the new canvas are
// cropped. Content is never resampled.
export function resizeCanvasImage(
  source: ImageData,
  width: number,
  height: number,
  left: number,
  top: number,
): ImageData {
  const out = createEmptyImage(width, height);
  for (let y = 0; y < height; y++) {
    let sourceY = y + top;
    if (sourceY < 0) {
      sourceY = 0;
    } else if (sourceY >= source.height) {
      sourceY = source.height - 1;
    }
    for (let x = 0; x < width; x++) {
      let sourceX = x + left;
      if (sourceX < 0) {
        sourceX = 0;
      } else if (sourceX >= source.width) {
        sourceX = source.width - 1;
      }
      const sourcePos = (sourceX + sourceY * source.width) * 4;
      const destPos = (x + y * width) * 4;
      out.data[destPos] = source.data[sourcePos];
      out.data[destPos + 1] = source.data[sourcePos + 1];
      out.data[destPos + 2] = source.data[sourcePos + 2];
      out.data[destPos + 3] = source.data[sourcePos + 3];
    }
  }
  return out;
}

export type Rotation = 90 | 180 | 270;

export function rotateImage(img: ImageData, degrees: Rotation): ImageData {
  const source = imageToCanvas(img);
  const swap = degrees === 90 || degrees === 270;
  const canvas = document.createElement('canvas');
  canvas.width = swap ? img.height : img.width;
  canvas.height = swap ? img.width : img.height;
  const ctx = canvas.getContext('2d')!;
  switch (degrees) {
    case 90:
      ctx.translate(canvas.width, 0);
      ctx.rotate(Math.PI / 2);
      break;
    case 180:
      ctx.translate(canvas.width, canvas.height);
      ctx.rotate(Math.PI);
      break;
    case 270:
      ctx.translate(0, canvas.height);
      ctx.rotate((3 * Math.PI) / 2);
      break;
  }
  ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

export type FlipAxis = 'x' | 'y';

export function flipImage(img: ImageData, axis: FlipAxis): ImageData {
  const source = imageToCanvas(img);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  if (axis === 'x') {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  } else {
    ctx.translate(0, canvas.height);
    ctx.scale(1, -1);
  }
  ctx.drawImage(source, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
