// Port of PixelPalette/Algorithm/BitmapConvert.cs and DirectBitmap.cs,
// backed by the browser's ImageData (RGBA, row-major, x + y * width).

import { getBrightness, getDistance, RGB } from './color';

export function createEmptyImage(width: number, height: number): ImageData {
  return new ImageData(width, height);
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
