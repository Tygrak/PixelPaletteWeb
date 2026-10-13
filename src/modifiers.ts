// Drawing modifiers: the symmetry guide (mirror / rotational) plus the math
// that mirrors paint strokes and fills around it.

import { clamp } from './color';

export type SymmetryMode = 'mirror' | 'rotational';

export interface SymmetryState {
  enabled: boolean;
  mode: SymmetryMode;
  // The guide line: center point in document pixels and direction (radians).
  // Mirror symmetry reflects across this line; rotational symmetry rotates
  // copies about the center. `length` is purely visual (how far the guide is
  // drawn); it is set automatically to span the document.
  cx: number;
  cy: number;
  angle: number;
  length: number;
  // Number of copies for rotational symmetry (including the original).
  segments: number;
  // While true, dragging on the canvas transforms the guide instead of drawing.
  transformMode: boolean;
}

export const MIN_SYMMETRY_SEGMENTS = 2;
export const MAX_SYMMETRY_SEGMENTS = 32;

// Affine transform of the 2x2 linear part plus translation:
// x' = a * x + c * y + e, y' = b * x + d * y + f
export interface SymmetryTransform {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export function symmetrySegmentCount(sym: SymmetryState): number {
  return clamp(Math.round(sym.segments), MIN_SYMMETRY_SEGMENTS, MAX_SYMMETRY_SEGMENTS);
}

// All copies produced by the modifier, starting with the identity.
export function symmetryTransforms(sym: SymmetryState): SymmetryTransform[] {
  const { cx, cy, angle } = sym;
  const transforms: SymmetryTransform[] = [];
  if (sym.mode === 'mirror') {
    transforms.push({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
    // Reflection about the line through (cx, cy) at `angle`.
    const cos2 = Math.cos(2 * angle);
    const sin2 = Math.sin(2 * angle);
    const a = cos2;
    const b = sin2;
    const c = sin2;
    const d = -cos2;
    transforms.push({ a, b, c, d, e: cx - (a * cx + c * cy), f: cy - (b * cx + d * cy) });
  } else {
    const count = symmetrySegmentCount(sym);
    for (let k = 0; k < count; k++) {
      const delta = (k * Math.PI * 2) / count;
      const cos = Math.cos(delta);
      const sin = Math.sin(delta);
      const a = cos;
      const b = sin;
      const c = -sin;
      const d = cos;
      transforms.push({ a, b, c, d, e: cx - (a * cx + c * cy), f: cy - (b * cx + d * cy) });
    }
  }
  return transforms;
}

// Transforms a direction (no translation); the linear parts used here are
// orthogonal, so lengths are preserved.
export function transformDirection(
  transform: SymmetryTransform,
  x: number,
  y: number,
): { x: number; y: number } {
  return { x: transform.a * x + transform.c * y, y: transform.b * x + transform.d * y };
}

export function transformAngle(transform: SymmetryTransform, angle: number): number {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return Math.atan2(transform.b * cos + transform.d * sin, transform.a * cos + transform.c * sin);
}

export function symmetryEndpoints(sym: SymmetryState): { x: number; y: number }[] {
  const half = sym.length / 2;
  const dx = Math.cos(sym.angle) * half;
  const dy = Math.sin(sym.angle) * half;
  return [
    { x: sym.cx - dx, y: sym.cy - dy },
    { x: sym.cx + dx, y: sym.cy + dy },
  ];
}

export type SymmetryHit = 'move' | 'rotate' | null;

// Points on the guide, close to its center, that grab-rotate the line. The
// offset is passed in so hit-testing (screen-scaled tolerance) and drawing
// (screen-scaled handle size) place the knobs at the same spot.
export function symmetryRotatePoints(sym: SymmetryState, offset: number): { x: number; y: number }[] {
  const dx = Math.cos(sym.angle) * offset;
  const dy = Math.sin(sym.angle) * offset;
  return [
    { x: sym.cx - dx, y: sym.cy - dy },
    { x: sym.cx + dx, y: sym.cy + dy },
  ];
}

export function hitTestSymmetry(
  sym: SymmetryState,
  x: number,
  y: number,
  tolerance: number,
): SymmetryHit {
  // Rotation knobs sit near the center so they stay reachable even when the
  // guide is longer than the canvas.
  const rotateOffset = Math.min(sym.length / 2, tolerance * 4);
  for (const point of symmetryRotatePoints(sym, rotateOffset)) {
    if (Math.hypot(x - point.x, y - point.y) <= tolerance) {
      return 'rotate';
    }
  }
  const [start, end] = symmetryEndpoints(sym);
  const lengthSquared = Math.max(0.0001, sym.length * sym.length);
  const t = clamp(
    ((x - start.x) * (end.x - start.x) + (y - start.y) * (end.y - start.y)) / lengthSquared,
    0,
    1,
  );
  const px = start.x + (end.x - start.x) * t;
  const py = start.y + (end.y - start.y) * t;
  return Math.hypot(x - px, y - py) <= tolerance ? 'move' : null;
}

export function drawSymmetryToContext(
  context: CanvasRenderingContext2D,
  sym: SymmetryState,
  active: boolean,
  handleHalfSize: number,
  lineScale: number,
): void {
  const [start, end] = symmetryEndpoints(sym);
  context.save();
  context.lineJoin = 'round';

  // Rotational symmetry: dashed rays at each copy's orientation.
  if (sym.mode === 'rotational') {
    const count = symmetrySegmentCount(sym);
    const radius = Math.max(sym.length / 2, 1);
    context.setLineDash([4 * lineScale, 4 * lineScale]);
    for (let k = 1; k < count; k++) {
      const angle = sym.angle + (k * Math.PI * 2) / count;
      const dx = Math.cos(angle) * radius;
      const dy = Math.sin(angle) * radius;
      for (const [width, color] of [
        [3, 'rgba(0, 0, 0, 0.5)'],
        [1, 'rgba(255, 255, 255, 0.6)'],
      ] as [number, string][]) {
        context.beginPath();
        context.moveTo(sym.cx - dx, sym.cy - dy);
        context.lineTo(sym.cx + dx, sym.cy + dy);
        context.lineWidth = width * lineScale;
        context.strokeStyle = color;
        context.stroke();
      }
    }
    context.setLineDash([]);
  }

  // The main axis line.
  for (const [width, color] of [
    [3, 'rgba(0, 0, 0, 0.75)'],
    [1, 'rgba(255, 255, 255, 0.95)'],
  ] as [number, string][]) {
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(end.x, end.y);
    context.lineWidth = width * lineScale;
    context.strokeStyle = color;
    context.stroke();
  }

  // Center marker.
  context.beginPath();
  context.arc(sym.cx, sym.cy, handleHalfSize * 0.8, 0, Math.PI * 2);
  context.fillStyle = 'rgba(255, 255, 255, 0.9)';
  context.fill();
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(0, 0, 0, 0.85)';
  context.stroke();

  // Rotation knobs sit near the center (see hitTestSymmetry) and are only
  // shown (and grabbable) in transform mode.
  if (active) {
    const rotateOffset = Math.min(sym.length / 2, handleHalfSize * 8);
    for (const point of symmetryRotatePoints(sym, rotateOffset)) {
      context.beginPath();
      context.arc(point.x, point.y, handleHalfSize, 0, Math.PI * 2);
      context.fillStyle = '#ffffff';
      context.fill();
      context.lineWidth = 1;
      context.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      context.stroke();
    }
  }
  context.restore();
}

// Mirrors the pixels a paint bucket just filled into the symmetric positions.
// `painted` is a layer-space mask of the filled pixels, `region` their
// layer-space bounds; returns the document-space bounds of the copies (null
// when nothing was mirrored).
export function applySymmetrizedFill(
  image: ImageData,
  painted: Uint8Array,
  region: { x: number; y: number; width: number; height: number },
  sym: SymmetryState,
  offsetX: number,
  offsetY: number,
): { x: number; y: number; width: number; height: number } | null {
  const transforms = symmetryTransforms(sym);
  if (transforms.length <= 1) {
    return null;
  }
  const { width, height, data } = image;
  // Snapshot the filled result: copies are stamped from it so overlapping
  // symmetric regions cannot read back their own writes.
  const source = new Uint8ClampedArray(data);
  const left = Math.max(0, region.x);
  const top = Math.max(0, region.y);
  const right = Math.min(width, region.x + region.width);
  const bottom = Math.min(height, region.y + region.height);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let index = 1; index < transforms.length; index++) {
    const transform = transforms[index];
    for (let ly = top; ly < bottom; ly++) {
      for (let lx = left; lx < right; lx++) {
        const maskIndex = lx + ly * width;
        if (!painted[maskIndex]) {
          continue;
        }
        const docX = lx + offsetX;
        const docY = ly + offsetY;
        const destLayerX = Math.round(transform.a * docX + transform.c * docY + transform.e) - offsetX;
        const destLayerY = Math.round(transform.b * docX + transform.d * docY + transform.f) - offsetY;
        if (destLayerX < 0 || destLayerX >= width || destLayerY < 0 || destLayerY >= height) {
          continue;
        }
        const srcPos = maskIndex * 4;
        const sourceAlpha = source[srcPos + 3] / 255;
        if (sourceAlpha <= 0) {
          continue;
        }
        const destPos = (destLayerX + destLayerY * width) * 4;
        const destAlpha = data[destPos + 3] / 255;
        const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
        if (outAlpha <= 0) {
          continue;
        }
        data[destPos] = Math.round(
          (source[srcPos] * sourceAlpha + data[destPos] * destAlpha * (1 - sourceAlpha)) / outAlpha,
        );
        data[destPos + 1] = Math.round(
          (source[srcPos + 1] * sourceAlpha + data[destPos + 1] * destAlpha * (1 - sourceAlpha)) / outAlpha,
        );
        data[destPos + 2] = Math.round(
          (source[srcPos + 2] * sourceAlpha + data[destPos + 2] * destAlpha * (1 - sourceAlpha)) / outAlpha,
        );
        data[destPos + 3] = Math.round(outAlpha * 255);
        const destDocX = destLayerX + offsetX;
        const destDocY = destLayerY + offsetY;
        if (destDocX < minX) minX = destDocX;
        if (destDocX > maxX) maxX = destDocX;
        if (destDocY < minY) minY = destDocY;
        if (destDocY > maxY) maxY = destDocY;
      }
    }
  }
  if (maxX < minX) {
    return null;
  }
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}
