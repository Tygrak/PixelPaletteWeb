// Tool definitions, keyboard shortcuts, and brush/eraser painting.

import { Brush, brushCoverage, TextureFrame } from './brushes';
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
  | 'knife'
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
  { id: 'knife', label: 'Palette Knife', shortcut: 'K' },
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
  // Tip shape, falloff and texture.
  brush: Brush;
  // Effective tip rotation for this stamp (base angle + any random jitter).
  angle: number;
  // Stroke-space texture frame (null = sample in tip-local space).
  frame: TextureFrame | null;
  // Optional per-stroke coverage cap; lets textured brushes keep their grain.
  strokeMask: Float32Array | null;
  // Snapshot of the layer's pixels at stroke start. Masked (textured) strokes
  // blend against this so the result is exactly alpha*coverage, no matter how
  // many overlapping stamps build the coverage.
  strokeBase: Uint8ClampedArray | null;
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
  const { offsetX, offsetY, color, selection, erase, brush } = params;
  // Edge-textured brushes can bulge slightly past the nominal radius.
  const reach = radius + 1 + (brush.edgeTexture > 0 ? radius * 0.4 : 0);
  const minX = Math.max(0, Math.floor(centerX - reach));
  const maxX = Math.min(width - 1, Math.ceil(centerX + reach));
  const minY = Math.max(0, Math.floor(centerY - reach));
  const maxY = Math.min(height - 1, Math.ceil(centerY + reach));

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
      const target = brushCoverage(brush, docX, docY, centerX, centerY, radius, params.angle, params.frame);
      if (target <= 0) {
        continue;
      }
      const pos = (layerX + layerY * width) * 4;
      // For masked (textured) strokes the destination is recomputed from the
      // stroke's base snapshot using the total coverage so far, so overlapping
      // stamps can never push the result past alpha*coverage or leave it below
      // it. Unmasked strokes composite incrementally as before.
      let src: Uint8ClampedArray = data;
      if (params.strokeMask && params.strokeBase) {
        const maskIndex = layerX + layerY * width;
        if (target <= params.strokeMask[maskIndex]) {
          continue;
        }
        params.strokeMask[maskIndex] = target;
        src = params.strokeBase;
      }
      const a = alpha * target;
      if (a <= 0) {
        continue;
      }
      if (erase) {
        const destAlpha = src[pos + 3] / 255;
        const newAlpha = destAlpha * (1 - a);
        data[pos + 3] = Math.round(newAlpha * 255);
        if (newAlpha <= 0.002) {
          data[pos] = 0;
          data[pos + 1] = 0;
          data[pos + 2] = 0;
        }
      } else {
        const destAlpha = src[pos + 3] / 255;
        const outAlpha = a + destAlpha * (1 - a);
        if (outAlpha <= 0) {
          continue;
        }
        data[pos] = Math.round((color.r * a + src[pos] * destAlpha * (1 - a)) / outAlpha);
        data[pos + 1] = Math.round((color.g * a + src[pos + 1] * destAlpha * (1 - a)) / outAlpha);
        data[pos + 2] = Math.round((color.b * a + src[pos + 2] * destAlpha * (1 - a)) / outAlpha);
        data[pos + 3] = Math.round(outAlpha * 255);
      }
    }
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

export interface CloneParams {
  radius: number;
  alpha: number;
  brush: Brush;
  angle: number;
  frame: TextureFrame | null;
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
    const layerY = Math.floor(docY - params.layerOffsetY);
    if (layerY < 0 || layerY >= height) {
      continue;
    }
    for (let docX = minX; docX <= maxX; docX++) {
      const layerX = Math.floor(docX - params.layerOffsetX);
      if (layerX < 0 || layerX >= width) {
        continue;
      }
      const docIndex = docX + docY * width;
      if (params.selection && !params.selection[docIndex]) {
        continue;
      }
      const coverage = brushCoverage(params.brush, docX, docY, centerX, centerY, radius, params.angle, params.frame, false);
      if (coverage <= 0) {
        continue;
      }
      // The clone offset comes from fractional pointer coordinates, so snap the
      // sampled source to whole pixels before indexing the buffer.
      const sourceX = Math.floor(layerX - params.cloneOffsetX);
      const sourceY = Math.floor(layerY - params.cloneOffsetY);
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
  brush: Brush;
  angle: number;
  frame: TextureFrame | null;
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
      // Heal also uses the tip shape only (no grain).
      const coverage = brushCoverage(params.brush, docX, docY, centerX, centerY, radius, params.angle, params.frame, false);
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

export interface KnifeParams {
  radius: number;
  // How strongly each stamp lays the picked-up paint back down (0-1).
  strength: number;
  // How far behind the cursor to sample the dragged paint, as a fraction of
  // the radius. Larger values smear further along the stroke.
  smear: number;
  brush: Brush;
  angle: number;
  frame: TextureFrame | null;
  selection: Selection | null;
  layerOffsetX: number;
  layerOffsetY: number;
  // Unit drag direction in document space.
  dirX: number;
  dirY: number;
}

// Palette knife: samples paint slightly behind the cursor (opposite the drag
// direction) and smears it back into the brush area, carrying both color and
// alpha along like a wet blade. Sampling the live target lets successive
// stamps chain, so color genuinely drags and blends down the stroke instead of
// repeating the original snapshot.
export function knifeStamp(target: ImageData, centerX: number, centerY: number, params: KnifeParams): void {
  const { width, height, data } = target;
  const radius = Math.max(0.5, params.radius);
  const strength = clamp01(params.strength);
  const { layerOffsetX, layerOffsetY, selection, dirX, dirY } = params;
  const reach = radius * 0.6 * params.smear;
  // Paint moves in the stroke direction, so the sampled source sits behind it.
  const baseX = -dirX * reach;
  const baseY = -dirY * reach;
  // A little perpendicular spread softens the streak into a smear.
  const perpX = -dirY;
  const perpY = dirX;
  const spread = radius * 0.2;

  const minX = Math.max(0, Math.floor(centerX - radius - 1));
  const maxX = Math.min(width - 1, Math.ceil(centerX + radius + 1));
  const minY = Math.max(0, Math.floor(centerY - radius - 1));
  const maxY = Math.min(height - 1, Math.ceil(centerY + radius + 1));

  for (let docY = minY; docY <= maxY; docY++) {
    const layerY = docY - layerOffsetY;
    if (layerY < 0 || layerY >= height) {
      continue;
    }
    for (let docX = minX; docX <= maxX; docX++) {
      const layerX = docX - layerOffsetX;
      if (layerX < 0 || layerX >= width) {
        continue;
      }
      const docIndex = docX + docY * width;
      if (selection && !selection[docIndex]) {
        continue;
      }
      // Knife uses the tip shape only (no grain).
      const coverage = brushCoverage(params.brush, docX, docY, centerX, centerY, radius, params.angle, params.frame, false);
      if (coverage <= 0) {
        continue;
      }

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumA = 0;
      let samples = 0;
      for (let tap = -1; tap <= 1; tap++) {
        const sampleX = Math.round(layerX + baseX + perpX * spread * tap);
        const sampleY = Math.round(layerY + baseY + perpY * spread * tap);
        if (sampleX < 0 || sampleX >= width || sampleY < 0 || sampleY >= height) {
          continue;
        }
        const samplePos = (sampleX + sampleY * width) * 4;
        sumR += data[samplePos];
        sumG += data[samplePos + 1];
        sumB += data[samplePos + 2];
        sumA += data[samplePos + 3];
        samples++;
      }
      if (samples === 0) {
        continue;
      }

      const sourceAlpha = ((sumA / samples) / 255) * coverage * strength;
      if (sourceAlpha <= 0) {
        continue;
      }
      const pos = (layerX + layerY * width) * 4;
      const destAlpha = data[pos + 3] / 255;
      const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
      if (outAlpha <= 0) {
        continue;
      }
      const srcR = sumR / samples;
      const srcG = sumG / samples;
      const srcB = sumB / samples;
      data[pos] = Math.round((srcR * sourceAlpha + data[pos] * destAlpha * (1 - sourceAlpha)) / outAlpha);
      data[pos + 1] = Math.round((srcG * sourceAlpha + data[pos + 1] * destAlpha * (1 - sourceAlpha)) / outAlpha);
      data[pos + 2] = Math.round((srcB * sourceAlpha + data[pos + 2] * destAlpha * (1 - sourceAlpha)) / outAlpha);
      data[pos + 3] = Math.round(outAlpha * 255);
    }
  }
}

function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  return value > 1 ? 1 : value;
}

// Scanline flood fill from a document-space seed position, constrained by the
// selection and matching colors within the tolerance of the seed pixel. Returns
// the document-space bounds of the painted pixels (null when nothing matched).
export function floodFill(
  image: ImageData,
  seedX: number,
  seedY: number,
  params: FillParams,
): { x: number; y: number; width: number; height: number } | null {
  const { width, height, data } = image;
  const startX = Math.floor(seedX - params.offsetX);
  const startY = Math.floor(seedY - params.offsetY);
  if (startX < 0 || startX >= width || startY < 0 || startY >= height) {
    return null;
  }
  const seedPos = (startX + startY * width) * 4;
  const seedR = data[seedPos];
  const seedG = data[seedPos + 1];
  const seedB = data[seedPos + 2];
  const seedA = data[seedPos + 3];
  // Compared squared, so the per-pixel distance check avoids a square root.
  const toleranceSquared = params.tolerance * params.tolerance;
  // Per-pixel state: 0 unknown, 1 matches, 2 does not match, 3 painted. The
  // distance test is the expensive part, so each pixel is tested only once.
  const state = new Uint8Array(width * height);
  const { selection, offsetX, offsetY, color, alpha } = params;

  const matches = (x: number, y: number): boolean => {
    const index = x + y * width;
    const current = state[index];
    if (current !== 0) {
      return current === 1;
    }
    if (selection && selection[x + offsetX + (y + offsetY) * width] !== 1) {
      state[index] = 2;
      return false;
    }
    const pos = index * 4;
    const dr = data[pos] - seedR;
    const dg = data[pos + 1] - seedG;
    const db = data[pos + 2] - seedB;
    const da = data[pos + 3] - seedA;
    // Compare alpha too: transparent pixels share a zero RGB with black lines,
    // so RGB-only matching would leak through everything on transparent images.
    if (dr * dr + dg * dg + db * db + da * da <= toleranceSquared) {
      state[index] = 1;
      return true;
    }
    state[index] = 2;
    return false;
  };
  const paint = (x: number, y: number): void => {
    const index = x + y * width;
    state[index] = 3;
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

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
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
    // Track the painted span's bounds (document space).
    if (cursor > left) {
      if (left < minX) {
        minX = left;
      }
      if (cursor - 1 > maxX) {
        maxX = cursor - 1;
      }
      if (y < minY) {
        minY = y;
      }
      if (y > maxY) {
        maxY = y;
      }
    }
  }
  if (maxX < 0) {
    return null;
  }
  return { x: minX + offsetX, y: minY + offsetY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
