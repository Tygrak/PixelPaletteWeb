// Selection mask helpers (marquee / lasso / magic wand).

import { RGB } from './color';
import { createEmptyImage } from './image';

export type Selection = Uint8Array;

export function rectSelection(
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Selection {
  const mask = new Uint8Array(width * height);
  const left = Math.max(0, Math.min(Math.floor(x0), Math.floor(x1)));
  const right = Math.min(width - 1, Math.max(Math.floor(x0), Math.floor(x1)));
  const top = Math.max(0, Math.min(Math.floor(y0), Math.floor(y1)));
  const bottom = Math.min(height - 1, Math.max(Math.floor(y0), Math.floor(y1)));
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      mask[x + y * width] = 1;
    }
  }
  return mask;
}

export interface Point {
  x: number;
  y: number;
}

export function polygonSelection(width: number, height: number, points: Point[]): Selection {
  const mask = new Uint8Array(width * height);
  if (points.length < 3) {
    return mask;
  }
  for (let y = 0; y < height; y++) {
    const crossings: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
        const t = (y - a.y) / (b.y - a.y);
        crossings.push(a.x + t * (b.x - a.x));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const startX = Math.max(0, Math.round(crossings[i]));
      const endX = Math.min(width - 1, Math.round(crossings[i + 1]));
      for (let x = startX; x <= endX; x++) {
        mask[x + y * width] = 1;
      }
    }
  }
  return mask;
}

function colorEquals(data: Uint8ClampedArray, pos: number, seed: RGB, tolerance: number): boolean {
  const dr = data[pos] - seed.r;
  const dg = data[pos + 1] - seed.g;
  const db = data[pos + 2] - seed.b;
  return Math.sqrt(dr * dr + dg * dg + db * db) <= tolerance;
}

export function wandSelection(
  image: ImageData,
  seedX: number,
  seedY: number,
  tolerance: number,
): Selection {
  const { width, height, data } = image;
  const mask = new Uint8Array(width * height);
  if (seedX < 0 || seedX >= width || seedY < 0 || seedY >= height) {
    return mask;
  }
  const seedPos = (seedX + seedY * width) * 4;
  const seed: RGB = { r: data[seedPos], g: data[seedPos + 1], b: data[seedPos + 2] };
  const stack: number[] = [seedX + seedY * width];
  mask[seedX + seedY * width] = 1;
  while (stack.length > 0) {
    const index = stack.pop()!;
    const x = index % width;
    const y = (index / width) | 0;
    const neighbors = [
      x > 0 ? index - 1 : -1,
      x < width - 1 ? index + 1 : -1,
      y > 0 ? index - width : -1,
      y < height - 1 ? index + width : -1,
    ];
    for (const neighbor of neighbors) {
      if (neighbor < 0 || mask[neighbor]) {
        continue;
      }
      if (colorEquals(data, neighbor * 4, seed, tolerance)) {
        mask[neighbor] = 1;
        stack.push(neighbor);
      }
    }
  }
  return mask;
}

// Builds a transparent overlay image with a 1px boundary around the selection.
export function selectionOverlay(mask: Selection, width: number, height: number): ImageData {
  const overlay = createEmptyImage(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = x + y * width;
      if (!mask[index]) {
        continue;
      }
      const boundary =
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        !mask[index - 1] ||
        !mask[index + 1] ||
        !mask[index - width] ||
        !mask[index + width];
      if (boundary) {
        const pos = index * 4;
        overlay.data[pos] = 255;
        overlay.data[pos + 1] = 255;
        overlay.data[pos + 2] = 255;
        overlay.data[pos + 3] = 230;
      }
    }
  }
  return overlay;
}
