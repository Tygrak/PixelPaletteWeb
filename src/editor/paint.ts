import { store } from '../appStore';
import { pressureFactor, textureModulates } from '../core/brushes';
import { clamp } from '../shared/color';
import { symmetryTransforms, SymmetryTransform, transformAngle, transformDirection } from '../core/modifiers';
import { cloneStamp, healStamp, knifeStamp, stampBrush, ToolId } from '../core/tools';

// Brush-stroke engine: stamps a stroke segment by segment onto the active
// layer, applying symmetry transforms, texture and clone/heal/knife variants.

type StrokeKind = 'brush' | 'eraser' | 'clone' | 'heal' | 'knife';

let strokeImage: ImageData | null = null;
let strokeSource: ImageData | null = null;
let strokeKind: StrokeKind = 'brush';
let strokeLastX = 0;
let strokeLastY = 0;
// Symmetry copies for the current stroke (null when the modifier is off).
let strokeTransforms: SymmetryTransform[] | null = null;
// Texture is sampled in stroke space, so a stroke tracks its own arc length,
// a random phase (to vary each stroke) and a per-stamp rotation jitter seed.
let strokeDistance = 0;
let strokeSeedX = 0;
let strokeSeedY = 0;
let strokeJitterSeed = 0;
let strokeStampIndex = 0;
// Per-stroke coverage cap used by textured brushes so grain is not filled in,
// plus a snapshot of the layer's pixels at stroke start to blend against.
let strokeMask: Float32Array | null = null;
let strokeBase: Uint8ClampedArray | null = null;

// Clone Stamp source point / offset (document space).
let cloneSource: { x: number; y: number } | null = null;
let cloneOffset: { x: number; y: number } | null = null;

export function isBrushTool(tool: ToolId): boolean {
    return tool === 'brush' || tool === 'eraser' || tool === 'clone' || tool === 'heal' || tool === 'knife';
}

export function hasActiveStroke(): boolean {
    return strokeImage !== null;
}

export function getCloneSource(): { x: number; y: number } | null {
    return cloneSource;
}

// Picking a new source point also clears the sampled offset, so the next
// stamp re-anchors to the clicked position.
export function setCloneSource(source: { x: number; y: number }): void {
    cloneSource = source;
    cloneOffset = null;
}

// Marker position for the clone overlay: the source follows the cursor once an
// offset has been established, otherwise it sits on the picked point.
export function getCloneMarker(hover: { x: number; y: number } | null): { x: number; y: number } | null {
    if (cloneOffset && hover) {
        return { x: hover.x - cloneOffset.x, y: hover.y - cloneOffset.y };
    }
    return cloneSource;
}

function beginStrokeState(textured: boolean, image: ImageData): void {
    strokeDistance = 0;
    strokeSeedX = Math.random() * 4096;
    strokeSeedY = Math.random() * 4096;
    strokeJitterSeed = (Math.random() * 0x7fffffff) | 0;
    strokeStampIndex = 0;
    strokeMask = textured ? new Float32Array(image.width * image.height) : null;
    strokeBase = textured ? new Uint8ClampedArray(image.data) : null;
    // The guide cannot move mid-stroke, so its transforms are captured once.
    strokeTransforms = store.symmetry.enabled ? symmetryTransforms(store.symmetry) : null;
}

// Runs `fn` for the original stamp and for every symmetric copy.
function forEachStrokeTransform(fn: (transform: SymmetryTransform | null) => void): void {
    if (!strokeTransforms) {
        fn(null);
        return;
    }
    for (const transform of strokeTransforms) {
        fn(transform);
    }
}

// Deterministic 0..1 hash used to jitter each stamp's tip rotation.
function hash01(n: number): number {
    let h = Math.imul(n ^ (n >>> 15), 2246822519);
    h = Math.imul(h ^ (h >>> 13), 3266489917);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
}

function startStroke(kind: StrokeKind, source: ImageData | null, image: ImageData, x: number, y: number, pressure: number): void {
    strokeKind = kind;
    strokeSource = source;
    strokeImage = image;
    strokeLastX = x;
    strokeLastY = y;
    const brushLike = kind === 'brush' || kind === 'eraser';
    beginStrokeState(brushLike && textureModulates(store.brush.texture), image);
    paintStrokeSegment(x, y, x, y, pressure);
}

export function startBrushStroke(kind: 'brush' | 'eraser', image: ImageData, x: number, y: number, pressure: number): void {
    startStroke(kind, null, image, x, y, pressure);
}

export function startCloneStroke(source: ImageData, image: ImageData, x: number, y: number, pressure: number): void {
    if (!cloneOffset && cloneSource) {
        cloneOffset = { x: x - cloneSource.x, y: y - cloneSource.y };
    }
    startStroke('clone', source, image, x, y, pressure);
}

export function startHealStroke(source: ImageData, image: ImageData, x: number, y: number, pressure: number): void {
    startStroke('heal', source, image, x, y, pressure);
}

export function startKnifeStroke(image: ImageData, x: number, y: number, pressure: number): void {
    startStroke('knife', null, image, x, y, pressure);
}

export function continueStroke(x: number, y: number, pressure: number): void {
    paintStrokeSegment(strokeLastX, strokeLastY, x, y, pressure);
    strokeLastX = x;
    strokeLastY = y;
}

export function endStroke(): void {
    // Paint anything still pending, then just refresh the UI: the stroke's
    // pixels were already rendered through the per-stroke damage updates, so
    // there is no need to recomposite the whole document again.
    flushPaintUpdate();
    strokeImage = null;
    strokeSource = null;
    strokeMask = null;
    strokeBase = null;
    store.emit();
}

function forEachStamp(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    radius: number,
    fn: (x: number, y: number) => void,
): void {
    const distance = Math.sqrt((toX - fromX) ** 2 + (toY - fromY) ** 2);
    const step = Math.max(0.5, radius / 3);
    const steps = Math.max(1, Math.ceil(distance / step));
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        fn(fromX + (toX - fromX) * t, fromY + (toY - fromY) * t);
    }
}

// Strokes mutate pixels immediately but render at most once per animation
// frame: damage rectangles accumulate and flush together, so high-rate pointer
// input never does more rendering work than the display can show.
// Rectangles stay separate (only overlapping ones are merged), so symmetric
// copies far apart do not inflate the repainted area.
let paintDamage: { x0: number; y0: number; x1: number; y1: number }[] = [];
let paintFrame = 0;

export function flushPaintUpdate(): void {
    if (paintFrame !== 0) {
        cancelAnimationFrame(paintFrame);
        paintFrame = 0;
    }
    const damage = paintDamage;
    paintDamage = [];
    if (damage.length > 0) {
        store.notifyAreas(
            damage.map((rect) => ({ x: rect.x0, y: rect.y0, width: rect.x1 - rect.x0, height: rect.y1 - rect.y0 })),
        );
    }
}

function schedulePaintUpdate(minX: number, minY: number, maxX: number, maxY: number): void {
    let rect = { x0: minX, y0: minY, x1: maxX, y1: maxY };
    // Union with every overlapping rectangle, repeating until no more overlap
    // (a union can grow into another rectangle).
    let merged = true;
    while (merged) {
        merged = false;
        for (let i = 0; i < paintDamage.length; i++) {
            const other = paintDamage[i];
            if (rect.x0 <= other.x1 && rect.x1 >= other.x0 && rect.y0 <= other.y1 && rect.y1 >= other.y0) {
                rect = {
                    x0: Math.min(rect.x0, other.x0),
                    y0: Math.min(rect.y0, other.y0),
                    x1: Math.max(rect.x1, other.x1),
                    y1: Math.max(rect.y1, other.y1),
                };
                paintDamage.splice(i, 1);
                merged = true;
                break;
            }
        }
    }
    paintDamage.push(rect);
    if (paintFrame === 0) {
        paintFrame = requestAnimationFrame(flushPaintUpdate);
    }
}

function paintStrokeSegment(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    pressure: number,
): void {
    if (!strokeImage) {
        return;
    }
    const layer = store.activeLayer;
    const offsetX = layer ? layer.offsetX : 0;
    const offsetY = layer ? layer.offsetY : 0;
    const brush = store.brush;
    const sizeFactor = pressureFactor(brush.pressure.sizeMin, brush.pressure.sizeCurve, pressure);
    const alphaFactor = pressureFactor(brush.pressure.alphaMin, brush.pressure.alphaCurve, pressure);
    const radius = Math.max(0.5, (store.brushSize / 2) * sizeFactor);
    // Pixel brushes always stamp fully opaque, on/off pixels (pixel art).
    const alpha = brush.pixel ? 1 : clamp(store.brushOpacity * alphaFactor, 0, 1);

    let dirX = toX - fromX;
    let dirY = toY - fromY;
    const segmentLength = Math.hypot(dirX, dirY);
    if (segmentLength > 1e-6) {
        dirX /= segmentLength;
        dirY /= segmentLength;
    } else {
        dirX = 1;
        dirY = 0;
    }

    if (strokeKind === 'clone' && strokeSource) {
        const frame = { dirX, dirY, distance: strokeDistance, seedX: strokeSeedX, seedY: strokeSeedY };
        const source = strokeSource;
        const baseOffsetX = cloneOffset?.x ?? 0;
        const baseOffsetY = cloneOffset?.y ?? 0;
        forEachStrokeTransform((transform) => {
            // The sampled source is mirrored with the stamp, so the clone offset
            // follows the copy's transform.
            const offset = transform
                ? transformDirection(transform, baseOffsetX, baseOffsetY)
                : { x: baseOffsetX, y: baseOffsetY };
            const params = {
                radius,
                alpha,
                brush,
                angle: transform ? transformAngle(transform, brush.angle) : brush.angle,
                frame,
                selection: store.selection,
                layerOffsetX: offsetX,
                layerOffsetY: offsetY,
                cloneOffsetX: offset.x,
                cloneOffsetY: offset.y,
            };
            forEachStamp(fromX, fromY, toX, toY, radius, (x, y) => {
                const sx = transform ? transform.a * x + transform.c * y + transform.e : x;
                const sy = transform ? transform.b * x + transform.d * y + transform.f : y;
                cloneStamp(strokeImage!, source, sx, sy, params);
            });
        });
    } else if (strokeKind === 'heal' && strokeSource) {
        const frame = { dirX, dirY, distance: strokeDistance, seedX: strokeSeedX, seedY: strokeSeedY };
        const source = strokeSource;
        forEachStrokeTransform((transform) => {
            const params = {
                radius,
                alpha,
                brush,
                angle: transform ? transformAngle(transform, brush.angle) : brush.angle,
                frame,
                selection: store.selection,
                layerOffsetX: offsetX,
                layerOffsetY: offsetY,
            };
            forEachStamp(fromX, fromY, toX, toY, radius, (x, y) => {
                const sx = transform ? transform.a * x + transform.c * y + transform.e : x;
                const sy = transform ? transform.b * x + transform.d * y + transform.f : y;
                healStamp(strokeImage!, source, sx, sy, params);
            });
        });
    } else if (strokeKind === 'knife') {
        const frame = { dirX, dirY, distance: strokeDistance, seedX: strokeSeedX, seedY: strokeSeedY };
        forEachStrokeTransform((transform) => {
            // Mirrored copies smear in the mirrored direction.
            const direction = transform ? transformDirection(transform, dirX, dirY) : { x: dirX, y: dirY };
            const params = {
                radius,
                strength: alpha,
                smear: store.knifeSmear,
                brush,
                angle: transform ? transformAngle(transform, brush.angle) : brush.angle,
                frame,
                selection: store.selection,
                layerOffsetX: offsetX,
                layerOffsetY: offsetY,
                dirX: direction.x,
                dirY: direction.y,
            };
            forEachStamp(fromX, fromY, toX, toY, radius, (x, y) => {
                const sx = transform ? transform.a * x + transform.c * y + transform.e : x;
                const sy = transform ? transform.b * x + transform.d * y + transform.f : y;
                knifeStamp(strokeImage!, sx, sy, params);
            });
        });
    } else {
        // Brush / eraser: stamp along the segment, advancing the stroke-space
        // distance so the texture travels with the brush, and jittering the tip.
        const spacing = Math.max(0.5, radius * brush.spacing);
        const steps = Math.max(1, Math.ceil(segmentLength / spacing));
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            const x = fromX + (toX - fromX) * t;
            const y = fromY + (toY - fromY) * t;
            const angleOffset =
                brush.rotationJitter > 0
                    ? (hash01(strokeJitterSeed + strokeStampIndex * 2654435761) * 2 - 1) * brush.rotationJitter
                    : 0;
            strokeStampIndex++;
            const frame = { dirX, dirY, distance: strokeDistance + segmentLength * t, seedX: strokeSeedX, seedY: strokeSeedY };
            forEachStrokeTransform((transform) => {
                const params = {
                    radius,
                    color: store.paintColor,
                    alpha,
                    selection: store.selection,
                    erase: strokeKind === 'eraser',
                    brush,
                    angle: transform ? transformAngle(transform, brush.angle + angleOffset) : brush.angle + angleOffset,
                    frame,
                    strokeMask,
                    strokeBase,
                    offsetX,
                    offsetY,
                };
                const sx = transform ? transform.a * x + transform.c * y + transform.e : x;
                const sy = transform ? transform.b * x + transform.d * y + transform.f : y;
                stampBrush(strokeImage!, sx, sy, params);
            });
        }
    }
    strokeDistance += segmentLength;
    // Only the segment's bounding box (expanded by the brush reach) changed, so
    // hand the renderer that damage rectangle instead of a full-document update.
    // With symmetry on, every copy's box is scheduled as damage instead.
    const reach = radius + 1 + (brush.edgeTexture > 0 ? radius * 0.4 : 0);
    const minX = Math.min(fromX, toX) - reach;
    const minY = Math.min(fromY, toY) - reach;
    const maxX = Math.max(fromX, toX) + reach;
    const maxY = Math.max(fromY, toY) + reach;
    if (strokeTransforms) {
        for (const transform of strokeTransforms) {
            let copyMinX = Infinity;
            let copyMinY = Infinity;
            let copyMaxX = -Infinity;
            let copyMaxY = -Infinity;
            for (const [cornerX, cornerY] of [
                [minX, minY],
                [maxX, minY],
                [maxX, maxY],
                [minX, maxY],
            ] as [number, number][]) {
                const tx = transform.a * cornerX + transform.c * cornerY + transform.e;
                const ty = transform.b * cornerX + transform.d * cornerY + transform.f;
                if (tx < copyMinX) copyMinX = tx;
                if (tx > copyMaxX) copyMaxX = tx;
                if (ty < copyMinY) copyMinY = ty;
                if (ty > copyMaxY) copyMaxY = ty;
            }
            schedulePaintUpdate(copyMinX, copyMinY, copyMaxX, copyMaxY);
        }
    } else {
        schedulePaintUpdate(minX, minY, maxX, maxY);
    }
}
