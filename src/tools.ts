// Tool definitions, keyboard shortcuts, and brush/eraser painting.

import { RGB } from './color';
import { Selection } from './selection';

export type ToolId =
  | 'move'
  | 'hand'
  | 'zoom'
  | 'brush'
  | 'eraser'
  | 'clone'
  | 'heal'
  | 'bucket'
  | 'lasso'
  | 'wand'
  | 'marquee'
  | 'eyedropper'
  | 'text'
  | 'resize';

export interface ToolInfo {
  id: ToolId;
  label: string;
  shortcut: string;
}

export const TOOLS: ToolInfo[] = [
  { id: 'move', label: 'Move', shortcut: 'V' },
  { id: 'hand', label: 'Hand', shortcut: 'H' },
  { id: 'zoom', label: 'Zoom', shortcut: 'Z' },
  { id: 'brush', label: 'Brush', shortcut: 'B' },
  { id: 'eraser', label: 'Eraser', shortcut: 'E' },
  { id: 'clone', label: 'Clone Stamp', shortcut: 'S' },
  { id: 'heal', label: 'Spot Healing Brush', shortcut: 'J' },
  { id: 'bucket', label: 'Paint Bucket', shortcut: 'G' },
  { id: 'lasso', label: 'Lasso', shortcut: 'L' },
  { id: 'wand', label: 'Wand', shortcut: 'W' },
  { id: 'marquee', label: 'Marquee', shortcut: 'M' },
  { id: 'eyedropper', label: 'Eyedropper', shortcut: 'I' },
  { id: 'text', label: 'Text', shortcut: 'T' },
  { id: 'resize', label: 'Resize Image', shortcut: 'R' },
];

export function toolForShortcut(key: string): ToolId | null {
  const upper = key.toUpperCase();
  const found = TOOLS.find((tool) => tool.shortcut === upper);
  return found ? found.id : null;
}

export interface BrushParams {
  radius: number;
  color: RGB;
  alpha: number;
  selection: Selection | null;
  erase: boolean;
  // Feather the brush edge: alpha falls off with distance from the center.
  soft: boolean;
  // Active-layer offset, so strokes are painted in document space (selection
  // masks are also in document space).
  offsetX: number;
  offsetY: number;
}

export function stampBrush(
  image: ImageData,
  centerX: number,
  centerY: number,
  params: BrushParams,
): void {
  const { width, height, data } = image;
  const radius = Math.max(0.5, params.radius);
  const alpha = params.alpha;
  const { offsetX, offsetY, color, selection, erase, soft } = params;
  const minX = Math.max(0, Math.floor(centerX - radius - 1));
  const maxX = Math.min(width - 1, Math.ceil(centerX + radius + 1));
  const minY = Math.max(0, Math.floor(centerY - radius - 1));
  const maxY = Math.min(height - 1, Math.ceil(centerY + radius + 1));

  for (let docY = minY; docY <= maxY; docY++) {
    const layerY = docY - offsetY;
    if (layerY < 0 || layerY >= height) {
      continue;
    }
    for (let docX = minX; docX <= maxX; docX++) {
      const layerX = docX - offsetX;
      if (layerX < 0 || layerX >= width) {
        continue;
      }
      const docIndex = docX + docY * width;
      if (selection && !selection[docIndex]) {
        continue;
      }
      const dx = docX - centerX;
      const dy = docY - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      let coverage: number;
      if (soft) {
        // Smooth radial falloff: full strength at the center, zero at the rim.
        const t = 1 - distance / radius;
        if (t <= 0) {
          continue;
        }
        coverage = t * t * (3 - 2 * t);
      } else {
        coverage = radius - distance + 0.5;
        if (coverage <= 0) {
          continue;
        }
        if (coverage > 1) {
          coverage = 1;
        }
      }
      const a = alpha * coverage;
      if (a <= 0) {
        continue;
      }
      const pos = (layerX + layerY * width) * 4;
      if (erase) {
        const destAlpha = data[pos + 3] / 255;
        const newAlpha = destAlpha * (1 - a);
        data[pos + 3] = Math.round(newAlpha * 255);
        if (newAlpha <= 0.002) {
          data[pos] = 0;
          data[pos + 1] = 0;
          data[pos + 2] = 0;
        }
      } else {
        const destAlpha = data[pos + 3] / 255;
        const outAlpha = a + destAlpha * (1 - a);
        if (outAlpha <= 0) {
          continue;
        }
        data[pos] = Math.round((color.r * a + data[pos] * destAlpha * (1 - a)) / outAlpha);
        data[pos + 1] = Math.round((color.g * a + data[pos + 1] * destAlpha * (1 - a)) / outAlpha);
        data[pos + 2] = Math.round((color.b * a + data[pos + 2] * destAlpha * (1 - a)) / outAlpha);
        data[pos + 3] = Math.round(outAlpha * 255);
      }
    }
  }
}

// Paints a continuous stroke between two points so fast pointer movements do
// not leave gaps. Returns nothing; mutates the image in place.
export function paintStroke(
  image: ImageData,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  params: BrushParams,
): void {
  const distance = Math.sqrt((toX - fromX) ** 2 + (toY - fromY) ** 2);
  const step = Math.max(0.5, params.radius / 3);
  const steps = Math.max(1, Math.ceil(distance / step));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    stampBrush(image, fromX + (toX - fromX) * t, fromY + (toY - fromY) * t, params);
  }
}

export interface FillParams {
  color: RGB;
  alpha: number;
  tolerance: number;
  selection: Selection | null;
  offsetX: number;
  offsetY: number;
}

// Shared brush-edge coverage: soft fades smoothly to the rim, hard is crisp
// with a 1px antialiased edge.
function coverageFor(distance: number, radius: number, soft: boolean): number {
  if (soft) {
    const t = 1 - distance / radius;
    if (t <= 0) {
      return 0;
    }
    return t * t * (3 - 2 * t);
  }
  const coverage = radius - distance + 0.5;
  if (coverage <= 0) {
    return 0;
  }
  return coverage > 1 ? 1 : coverage;
}

export interface CloneParams {
  radius: number;
  alpha: number;
  soft: boolean;
  selection: Selection | null;
  layerOffsetX: number;
  layerOffsetY: number;
  cloneOffsetX: number;
  cloneOffsetY: number;
}

// Copies pixels from `source` (a snapshot of the layer) into `target`, offset
// by the clone offset established from the Alt-click source point.
export function cloneStamp(
  target: ImageData,
  source: ImageData,
  centerX: number,
  centerY: number,
  params: CloneParams,
): void {
  const { width, height } = target;
  const targetData = target.data;
  const sourceData = source.data;
  const radius = Math.max(0.5, params.radius);
  const minX = Math.max(0, Math.floor(centerX - radius - 1));
  const maxX = Math.min(width - 1, Math.ceil(centerX + radius + 1));
  const minY = Math.max(0, Math.floor(centerY - radius - 1));
  const maxY = Math.min(height - 1, Math.ceil(centerY + radius + 1));

  for (let docY = minY; docY <= maxY; docY++) {
    const layerY = docY - params.layerOffsetY;
    if (layerY < 0 || layerY >= height) {
      continue;
    }
    for (let docX = minX; docX <= maxX; docX++) {
      const layerX = docX - params.layerOffsetX;
      if (layerX < 0 || layerX >= width) {
        continue;
      }
      const docIndex = docX + docY * width;
      if (params.selection && !params.selection[docIndex]) {
        continue;
      }
      const coverage = coverageFor(Math.hypot(docX - centerX, docY - centerY), radius, params.soft);
      if (coverage <= 0) {
        continue;
      }
      const sourceX = layerX - params.cloneOffsetX;
      const sourceY = layerY - params.cloneOffsetY;
      if (sourceX < 0 || sourceX >= width || sourceY < 0 || sourceY >= height) {
        continue;
      }
      const sourcePos = (sourceX + sourceY * width) * 4;
      const sourceAlpha = (sourceData[sourcePos + 3] / 255) * coverage * params.alpha;
      if (sourceAlpha <= 0) {
        continue;
      }
      const destPos = (layerX + layerY * width) * 4;
      const destAlpha = targetData[destPos + 3] / 255;
      const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
      if (outAlpha <= 0) {
        continue;
      }
      targetData[destPos] = Math.round(
        (sourceData[sourcePos] * sourceAlpha + targetData[destPos] * destAlpha * (1 - sourceAlpha)) / outAlpha,
      );
      targetData[destPos + 1] = Math.round(
        (sourceData[sourcePos + 1] * sourceAlpha + targetData[destPos + 1] * destAlpha * (1 - sourceAlpha)) / outAlpha,
      );
      targetData[destPos + 2] = Math.round(
        (sourceData[sourcePos + 2] * sourceAlpha + targetData[destPos + 2] * destAlpha * (1 - sourceAlpha)) / outAlpha,
      );
      targetData[destPos + 3] = Math.round(outAlpha * 255);
    }
  }
}

export interface HealParams {
  radius: number;
  alpha: number;
  soft: boolean;
  selection: Selection | null;
  layerOffsetX: number;
  layerOffsetY: number;
}

// Spot healing: averages the ring of pixels surrounding the brush (from a
// snapshot) and feathers that average into the brushed area.
export function healStamp(
  target: ImageData,
  source: ImageData,
  centerX: number,
  centerY: number,
  params: HealParams,
): void {
  const { width, height } = target;
  const targetData = target.data;
  const sourceData = source.data;
  const radius = Math.max(0.5, params.radius);
  const inner = radius * 1.1;
  const outer = radius * 1.7;

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  const aMinX = Math.max(0, Math.floor(centerX - outer));
  const aMaxX = Math.min(width - 1, Math.ceil(centerX + outer));
  const aMinY = Math.max(0, Math.floor(centerY - outer));
  const aMaxY = Math.min(height - 1, Math.ceil(centerY + outer));
  for (let docY = aMinY; docY <= aMaxY; docY++) {
    const layerY = docY - params.layerOffsetY;
    if (layerY < 0 || layerY >= height) {
      continue;
    }
    for (let docX = aMinX; docX <= aMaxX; docX++) {
      const layerX = docX - params.layerOffsetX;
      if (layerX < 0 || layerX >= width) {
        continue;
      }
      const distance = Math.hypot(docX - centerX, docY - centerY);
      if (distance < inner || distance > outer) {
        continue;
      }
      if (params.selection && !params.selection[docX + docY * width]) {
        continue;
      }
      const pos = (layerX + layerY * width) * 4;
      sumR += sourceData[pos];
      sumG += sourceData[pos + 1];
      sumB += sourceData[pos + 2];
      count++;
    }
  }
  if (count === 0) {
    return;
  }
  const averageR = sumR / count;
  const averageG = sumG / count;
  const averageB = sumB / count;

  const minX = Math.max(0, Math.floor(centerX - radius - 1));
  const maxX = Math.min(width - 1, Math.ceil(centerX + radius + 1));
  const minY = Math.max(0, Math.floor(centerY - radius - 1));
  const maxY = Math.min(height - 1, Math.ceil(centerY + radius + 1));
  for (let docY = minY; docY <= maxY; docY++) {
    const layerY = docY - params.layerOffsetY;
    if (layerY < 0 || layerY >= height) {
      continue;
    }
    for (let docX = minX; docX <= maxX; docX++) {
      const layerX = docX - params.layerOffsetX;
      if (layerX < 0 || layerX >= width) {
        continue;
      }
      if (params.selection && !params.selection[docX + docY * width]) {
        continue;
      }
      const coverage = coverageFor(Math.hypot(docX - centerX, docY - centerY), radius, params.soft);
      if (coverage <= 0) {
        continue;
      }
      const alpha = params.alpha * coverage;
      if (alpha <= 0) {
        continue;
      }
      const pos = (layerX + layerY * width) * 4;
      const destAlpha = targetData[pos + 3] / 255;
      const outAlpha = alpha + destAlpha * (1 - alpha);
      if (outAlpha <= 0) {
        continue;
      }
      targetData[pos] = Math.round((averageR * alpha + targetData[pos] * destAlpha * (1 - alpha)) / outAlpha);
      targetData[pos + 1] = Math.round((averageG * alpha + targetData[pos + 1] * destAlpha * (1 - alpha)) / outAlpha);
      targetData[pos + 2] = Math.round((averageB * alpha + targetData[pos + 2] * destAlpha * (1 - alpha)) / outAlpha);
      targetData[pos + 3] = Math.round(outAlpha * 255);
    }
  }
}

// Scanline flood fill from a document-space seed position, constrained by the
// selection and matching colors within the tolerance of the seed pixel.
export function floodFill(image: ImageData, seedX: number, seedY: number, params: FillParams): void {
  const { width, height, data } = image;
  const startX = Math.floor(seedX - params.offsetX);
  const startY = Math.floor(seedY - params.offsetY);
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) {
    return;
  }
  const seedPos = (startX + startY * width) * 4;
  const seedR = data[seedPos];
  const seedG = data[seedPos + 1];
  const seedB = data[seedPos + 2];
  const tolerance = params.tolerance;
  const visited = new Uint8Array(width * height);
  const { selection, offsetX, offsetY, color, alpha } = params;

  const inSelection = (x: number, y: number): boolean => {
    if (!selection) {
      return true;
    }
    return selection[x + offsetX + (y + offsetY) * width] === 1;
  };
  const matches = (x: number, y: number): boolean => {
    const index = x + y * width;
    if (visited[index] || !inSelection(x, y)) {
      return false;
    }
    const pos = index * 4;
    const dr = data[pos] - seedR;
    const dg = data[pos + 1] - seedG;
    const db = data[pos + 2] - seedB;
    return Math.sqrt(dr * dr + dg * dg + db * db) <= tolerance;
  };
  const paint = (x: number, y: number): void => {
    const index = x + y * width;
    visited[index] = 1;
    const pos = index * 4;
    if (alpha >= 1) {
      data[pos] = color.r;
      data[pos + 1] = color.g;
      data[pos + 2] = color.b;
      data[pos + 3] = 255;
      return;
    }
    const destAlpha = data[pos + 3] / 255;
    const outAlpha = alpha + destAlpha * (1 - alpha);
    if (outAlpha <= 0) {
      return;
    }
    data[pos] = Math.round((color.r * alpha + data[pos] * destAlpha * (1 - alpha)) / outAlpha);
    data[pos + 1] = Math.round((color.g * alpha + data[pos + 1] * destAlpha * (1 - alpha)) / outAlpha);
    data[pos + 2] = Math.round((color.b * alpha + data[pos + 2] * destAlpha * (1 - alpha)) / outAlpha);
    data[pos + 3] = Math.round(outAlpha * 255);
  };

  const stack: number[] = [startX, startY];
  while (stack.length > 0) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    let left = x;
    while (left >= 0 && matches(left, y)) {
      left--;
    }
    left++;
    let spanAbove = false;
    let spanBelow = false;
    let cursor = left;
    while (cursor < width && matches(cursor, y)) {
      paint(cursor, y);
      if (y > 0) {
        if (!spanAbove && matches(cursor, y - 1)) {
          stack.push(cursor, y - 1);
          spanAbove = true;
        } else if (spanAbove && !matches(cursor, y - 1)) {
          spanAbove = false;
        }
      }
      if (y < height - 1) {
        if (!spanBelow && matches(cursor, y + 1)) {
          stack.push(cursor, y + 1);
          spanBelow = true;
        } else if (spanBelow && !matches(cursor, y + 1)) {
          spanBelow = false;
        }
      }
      cursor++;
    }
  }
}
