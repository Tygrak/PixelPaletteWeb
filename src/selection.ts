// Selection mask helpers (marquee / lasso / magic wand).

import { RGB } from './color';
import { createEmptyImage } from './image';

export type Selection = Uint8Array;

export type SelectionMode = 'replace' | 'add' | 'subtract';

// Combines a new selection region with the existing one. Returns null when the
// result selects nothing. In 'replace' mode the addition is returned directly
// (the caller passes a freshly built mask), avoiding a full-size copy.
export function combineSelection(
  base: Selection | null,
  addition: Selection,
  mode: SelectionMode,
): Selection | null {
  const length = addition.length;
  if (mode === 'replace') {
    let count = 0;
    for (let i = 0; i < length; i++) {
      if (addition[i]) {
        count++;
      }
    }
    return count > 0 ? addition : null;
  }
  const result = new Uint8Array(length);
  let count = 0;
  if (mode === 'add') {
    for (let i = 0; i < length; i++) {
      if ((base && base[i]) || addition[i]) {
        result[i] = 1;
        count++;
      }
    }
  } else {
    if (!base) {
      return null;
    }
    for (let i = 0; i < length; i++) {
      if (base[i] && !addition[i]) {
        result[i] = 1;
        count++;
      }
    }
  }
  return count > 0 ? result : null;
}

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

function colorEquals(
  data: Uint8ClampedArray,
  pos: number,
  seed: RGB,
  seedAlpha: number,
  tolerance: number,
): boolean {
  const dr = data[pos] - seed.r;
  const dg = data[pos + 1] - seed.g;
  const db = data[pos + 2] - seed.b;
  const da = data[pos + 3] - seedAlpha;
  // Compare alpha too: transparent pixels share a zero RGB with black lines, so
  // RGB-only matching would select through everything on transparent images.
  return Math.sqrt(dr * dr + dg * dg + db * db + da * da) <= tolerance;
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
  const seedAlpha = data[seedPos + 3];
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
      if (colorEquals(data, neighbor * 4, seed, seedAlpha, tolerance)) {
        mask[neighbor] = 1;
        stack.push(neighbor);
      }
    }
  }
  return mask;
}

// Builds a transparent image with a black/white checkerboard border around the
// selection (marching-ants style, visible on any background). Only the area
// around the selection's bounds is rasterized, so huge documents stay fast. The
// border is `thickness` document pixels wide so it stays visible when the image
// is displayed zoomed out (where a single pixel would disappear). Returns the
// image plus the document-space position it belongs at.
export function selectionOverlay(
  mask: Selection,
  width: number,
  height: number,
  thickness: number,
  bounds: { x0: number; y0: number; x1: number; y1: number },
): { image: ImageData; x: number; y: number } {
  // The region is the selection's bounds padded by the border width, which is
  // enough for the dilation below (radius = thickness - 1).
  const x0 = Math.max(0, bounds.x0 - thickness);
  const y0 = Math.max(0, bounds.y0 - thickness);
  const x1 = Math.min(width, bounds.x1 + 1 + thickness);
  const y1 = Math.min(height, bounds.y1 + 1 + thickness);
  const regionW = Math.max(1, x1 - x0);
  const regionH = Math.max(1, y1 - y0);

  const boundary = new Uint8Array(regionW * regionH);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const index = x + y * width;
      if (!mask[index]) {
        continue;
      }
      if (
        x === 0 ||
        y === 0 ||
        x === width - 1 ||
        y === height - 1 ||
        !mask[index - 1] ||
        !mask[index + 1] ||
        !mask[index - width] ||
        !mask[index + width]
      ) {
        boundary[x - x0 + (y - y0) * regionW] = 1;
      }
    }
  }
  const shape = thickness > 1 ? dilateMask(boundary, regionW, regionH, thickness - 1) : boundary;
  // Ant cells grow with the border so the pattern stays a few screen pixels
  // wide at any zoom instead of averaging out into a thin grey line.
  const cell = Math.max(3, thickness * 2);
  const image = createEmptyImage(regionW, regionH);
  for (let y = 0; y < regionH; y++) {
    for (let x = 0; x < regionW; x++) {
      if (!shape[x + y * regionW]) {
        continue;
      }
      const pos = (x + y * regionW) * 4;
      // Absolute coordinates keep the pattern aligned as the region changes.
      const dark = ((Math.floor((x + x0) / cell) + Math.floor((y + y0) / cell)) & 1) === 0;
      const value = dark ? 0 : 255;
      image.data[pos] = value;
      image.data[pos + 1] = value;
      image.data[pos + 2] = value;
      image.data[pos + 3] = 255;
    }
  }
  return { image, x: x0, y: y0 };
}

// Grows a mask by `radius` pixels with a square kernel, using two separable
// sliding-window passes (O(width * height) regardless of the radius).
function dilateMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const horizontal = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let count = 0;
    const firstEnd = Math.min(width - 1, radius);
    for (let x = 0; x <= firstEnd; x++) {
      count += mask[row + x];
    }
    for (let x = 0; x < width; x++) {
      if (count > 0) {
        horizontal[row + x] = 1;
      }
      const add = x + radius + 1;
      const remove = x - radius;
      if (add < width) {
        count += mask[row + add];
      }
      if (remove >= 0) {
        count -= mask[row + remove];
      }
    }
  }
  const result = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    let count = 0;
    const firstEnd = Math.min(height - 1, radius);
    for (let y = 0; y <= firstEnd; y++) {
      count += horizontal[y * width + x];
    }
    for (let y = 0; y < height; y++) {
      if (count > 0) {
        result[y * width + x] = 1;
      }
      const add = y + radius + 1;
      const remove = y - radius;
      if (add < height) {
        count += horizontal[add * width + x];
      }
      if (remove >= 0) {
        count -= horizontal[remove * width + x];
      }
    }
  }
  return result;
}
