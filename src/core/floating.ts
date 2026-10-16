// Floating selection: lift selected pixels, transform them (move/scale/rotate)
// and bake them back into the active layer.

import { createEmptyImage } from '../shared/image';
import { Selection } from './selection';

export interface Floating {
    buffer: ImageData;
    originW: number;
    originH: number;
    cx: number;
    cy: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
}

export interface Box {
    cx: number;
    cy: number;
    w: number;
    h: number;
    rotation: number;
}

export interface Bounds {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

export function selectionBounds(mask: Selection, width: number, height: number): Bounds | null {
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (mask[x + y * width]) {
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            }
        }
    }
    if (maxX < 0) {
        return null;
    }
    return { x0: minX, y0: minY, x1: maxX + 1, y1: maxY + 1 };
}

export function liftSelection(
    layerImage: ImageData,
    mask: Selection,
    offsetX: number,
    offsetY: number,
    docWidth: number,
    docHeight: number,
    copy = false,
): { floating: Floating; cleared: ImageData } | null {
    const bounds = selectionBounds(mask, docWidth, docHeight);
    if (!bounds) {
        return null;
    }
    const bw = bounds.x1 - bounds.x0;
    const bh = bounds.y1 - bounds.y0;
    const buffer = createEmptyImage(bw, bh);
    const cleared = copy ? layerImage : createEmptyImage(docWidth, docHeight);
    if (!copy) {
        cleared.data.set(layerImage.data);
    }

    for (let docY = bounds.y0; docY < bounds.y1; docY++) {
        const layerY = docY - offsetY;
        if (layerY < 0 || layerY >= layerImage.height) {
            continue;
        }
        for (let docX = bounds.x0; docX < bounds.x1; docX++) {
            if (!mask[docX + docY * docWidth]) {
                continue;
            }
            const layerX = docX - offsetX;
            if (layerX < 0 || layerX >= layerImage.width) {
                continue;
            }
            const sourcePos = (layerX + layerY * layerImage.width) * 4;
            const bufferPos = (docX - bounds.x0 + (docY - bounds.y0) * bw) * 4;
            buffer.data[bufferPos] = layerImage.data[sourcePos];
            buffer.data[bufferPos + 1] = layerImage.data[sourcePos + 1];
            buffer.data[bufferPos + 2] = layerImage.data[sourcePos + 2];
            buffer.data[bufferPos + 3] = layerImage.data[sourcePos + 3];
            if (!copy) {
                cleared.data[sourcePos] = 0;
                cleared.data[sourcePos + 1] = 0;
                cleared.data[sourcePos + 2] = 0;
                cleared.data[sourcePos + 3] = 0;
            }
        }
    }

    const floating: Floating = {
        buffer,
        originW: bw,
        originH: bh,
        cx: bounds.x0 + bw / 2,
        cy: bounds.y0 + bh / 2,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
    };
    return { floating, cleared };
}

export function boxFromFloating(floating: Floating): Box {
    return {
        cx: floating.cx,
        cy: floating.cy,
        w: floating.originW * floating.scaleX,
        h: floating.originH * floating.scaleY,
        rotation: floating.rotation,
    };
}

export function boxFromBounds(bounds: Bounds): Box {
    return {
        cx: (bounds.x0 + bounds.x1) / 2,
        cy: (bounds.y0 + bounds.y1) / 2,
        w: bounds.x1 - bounds.x0,
        h: bounds.y1 - bounds.y0,
        rotation: 0,
    };
}

export function boxCorners(box: Box): { x: number; y: number }[] {
    const cos = Math.cos(box.rotation);
    const sin = Math.sin(box.rotation);
    const hw = box.w / 2;
    const hh = box.h / 2;
    return [
        [-hw, -hh],
        [hw, -hh],
        [hw, hh],
        [-hw, hh],
    ].map(([x, y]) => ({ x: box.cx + x * cos - y * sin, y: box.cy + x * sin + y * cos }));
}

export function boxHandlePoints(box: Box): { id: BoxHit; x: number; y: number }[] {
    const corners = boxCorners(box);
    const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
        x: (a.x + b.x) / 2,
        y: (a.y + b.y) / 2,
    });
    return [
        { id: 'nw', ...corners[0] },
        { id: 'n', ...mid(corners[0], corners[1]) },
        { id: 'ne', ...corners[1] },
        { id: 'e', ...mid(corners[1], corners[2]) },
        { id: 'se', ...corners[2] },
        { id: 's', ...mid(corners[2], corners[3]) },
        { id: 'sw', ...corners[3] },
        { id: 'w', ...mid(corners[3], corners[0]) },
    ];
}

export type BoxHit = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate' | 'inside' | null;

export function hitTestBox(box: Box, x: number, y: number, tolerance: number): BoxHit {
    const cos = Math.cos(box.rotation);
    const sin = Math.sin(box.rotation);
    const dx = x - box.cx;
    const dy = y - box.cy;
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;
    const hw = box.w / 2;
    const hh = box.h / 2;

    const localHandles: { id: BoxHit; x: number; y: number }[] = [
        { id: 'nw', x: -hw, y: -hh },
        { id: 'n', x: 0, y: -hh },
        { id: 'ne', x: hw, y: -hh },
        { id: 'e', x: hw, y: 0 },
        { id: 'se', x: hw, y: hh },
        { id: 's', x: 0, y: hh },
        { id: 'sw', x: -hw, y: hh },
        { id: 'w', x: -hw, y: 0 },
    ];
    for (const handle of localHandles) {
        if (Math.hypot(localX - handle.x, localY - handle.y) <= tolerance) {
            return handle.id;
        }
    }
    // Rotation zones sit just outside the corners (never inside the box).
    if (Math.abs(localX) > hw || Math.abs(localY) > hh) {
        for (const corner of [
            [-hw, -hh],
            [hw, -hh],
            [hw, hh],
            [-hw, hh],
        ]) {
            const distance = Math.hypot(localX - corner[0], localY - corner[1]);
            if (distance > tolerance && distance <= tolerance * 2.5) {
                return 'rotate';
            }
        }
    }
    if (Math.abs(localX) <= hw && Math.abs(localY) <= hh) {
        return 'inside';
    }
    return null;
}

export function cursorForHit(hit: BoxHit): string | null {
    switch (hit) {
        case 'nw':
        case 'se':
            return 'nwse-resize';
        case 'ne':
        case 'sw':
            return 'nesw-resize';
        case 'n':
        case 's':
            return 'ns-resize';
        case 'e':
        case 'w':
            return 'ew-resize';
        case 'rotate':
            return 'grab';
        case 'inside':
            return 'move';
        default:
            return null;
    }
}

export interface ScaleState {
    cx: number;
    cy: number;
    scaleX: number;
    scaleY: number;
    rotation: number;
    originW: number;
    originH: number;
}

// Computes the new box transform for a scale-handle drag.
// Default (no Shift): the opposite edge/corner stays fixed and the dragged
// side follows the pointer (non-proportional). Shift: scales about the center.
export function computeScale(
    state: ScaleState,
    handle: string,
    pointerX: number,
    pointerY: number,
    shiftKey: boolean,
    min = 0.02,
): { cx: number; cy: number; scaleX: number; scaleY: number } {
    const cos = Math.cos(state.rotation);
    const sin = Math.sin(state.rotation);
    const dx = pointerX - state.cx;
    const dy = pointerY - state.cy;
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;
    const { originW, originH } = state;
    const halfW = originW / 2;
    const halfH = originH / 2;

    const sideX = handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0;
    const sideY = handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0;

    const startHalfW = (originW * state.scaleX) / 2;
    const startHalfH = (originH * state.scaleY) / 2;
    const anchorLocalStartX = -sideX * startHalfW;
    const anchorLocalStartY = -sideY * startHalfH;

    let scaleX = state.scaleX;
    let scaleY = state.scaleY;
    if (sideX !== 0) {
        scaleX = shiftKey ? (localX * sideX) / halfW : ((localX - anchorLocalStartX) * sideX) / originW;
    }
    if (sideY !== 0) {
        scaleY = shiftKey ? (localY * sideY) / halfH : ((localY - anchorLocalStartY) * sideY) / originH;
    }
    if (Math.abs(scaleX) < min) scaleX = (scaleX < 0 ? -1 : 1) * min;
    if (Math.abs(scaleY) < min) scaleY = (scaleY < 0 ? -1 : 1) * min;

    let cx = state.cx;
    let cy = state.cy;
    if (!shiftKey) {
        const anchorX = state.cx + anchorLocalStartX * cos - anchorLocalStartY * sin;
        const anchorY = state.cy + anchorLocalStartX * sin + anchorLocalStartY * cos;
        const newAnchorLocalX = -sideX * ((originW * scaleX) / 2);
        const newAnchorLocalY = -sideY * ((originH * scaleY) / 2);
        const newAnchorX = newAnchorLocalX * cos - newAnchorLocalY * sin;
        const newAnchorY = newAnchorLocalX * sin + newAnchorLocalY * cos;
        cx = anchorX - newAnchorX;
        cy = anchorY - newAnchorY;
    }
    return { cx, cy, scaleX, scaleY };
}

export function drawFloatingToContext(context: CanvasRenderingContext2D, floating: Floating): void {
    const bufferCanvas = document.createElement('canvas');
    bufferCanvas.width = floating.originW;
    bufferCanvas.height = floating.originH;
    bufferCanvas.getContext('2d')!.putImageData(floating.buffer, 0, 0);
    context.save();
    context.imageSmoothingEnabled = true;
    context.translate(floating.cx, floating.cy);
    context.rotate(floating.rotation);
    context.scale(floating.scaleX, floating.scaleY);
    context.drawImage(bufferCanvas, -floating.originW / 2, -floating.originH / 2);
    context.restore();
}

export function drawBoxToContext(
    context: CanvasRenderingContext2D,
    box: Box,
    handleHalfSize: number,
    lineScale = 1,
): void {
    const corners = boxCorners(box);
    context.save();
    context.lineJoin = 'round';
    for (const [width, color] of [
        [3, 'rgba(0, 0, 0, 0.75)'],
        [1, 'rgba(255, 255, 255, 0.95)'],
    ] as [number, string][]) {
        context.beginPath();
        context.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < corners.length; i++) {
            context.lineTo(corners[i].x, corners[i].y);
        }
        context.closePath();
        context.lineWidth = width * lineScale;
        context.strokeStyle = color;
        context.stroke();
    }
    for (const handle of boxHandlePoints(box)) {
        context.fillStyle = '#ffffff';
        context.fillRect(handle.x - handleHalfSize, handle.y - handleHalfSize, handleHalfSize * 2, handleHalfSize * 2);
        context.lineWidth = 1;
        context.strokeStyle = 'rgba(0, 0, 0, 0.85)';
        context.strokeRect(handle.x - handleHalfSize, handle.y - handleHalfSize, handleHalfSize * 2, handleHalfSize * 2);
    }
    context.restore();
}

export function bakeFloating(floating: Floating, width: number, height: number): ImageData {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d')!;
    drawFloatingToContext(context, floating);
    return context.getImageData(0, 0, width, height);
}

// One lifted piece of a multi-layer floating: a layer's visible content with
// its center relative to the floating's box center. Multi-layer floats keep one
// piece per layer so each is baked back into the layer it came from.
export interface FloatingPart {
    buffer: ImageData;
    localCx: number;
    localCy: number;
}

// Renders one piece with the floating's translate/scale/rotate, as a
// document-sized image ready to be composited over its layer.
export function bakeFloatingPart(
    part: FloatingPart,
    floating: Floating,
    width: number,
    height: number,
): ImageData {
    const cos = Math.cos(floating.rotation);
    const sin = Math.sin(floating.rotation);
    const localX = part.localCx * floating.scaleX;
    const localY = part.localCy * floating.scaleY;
    const single: Floating = {
        buffer: part.buffer,
        originW: part.buffer.width,
        originH: part.buffer.height,
        cx: floating.cx + localX * cos - localY * sin,
        cy: floating.cy + localX * sin + localY * cos,
        scaleX: floating.scaleX,
        scaleY: floating.scaleY,
        rotation: floating.rotation,
    };
    return bakeFloating(single, width, height);
}

export function compositeOverLayer(
    layer: ImageData,
    overlay: ImageData,
    offsetX: number,
    offsetY: number,
): void {
    for (let y = 0; y < layer.height; y++) {
        const dy = y + offsetY;
        if (dy < 0 || dy >= overlay.height) {
            continue;
        }
        for (let x = 0; x < layer.width; x++) {
            const dx = x + offsetX;
            if (dx < 0 || dx >= overlay.width) {
                continue;
            }
            const sourcePos = (dx + dy * overlay.width) * 4;
            const sourceAlpha = overlay.data[sourcePos + 3] / 255;
            if (sourceAlpha <= 0) {
                continue;
            }
            const destPos = (x + y * layer.width) * 4;
            const destAlpha = layer.data[destPos + 3] / 255;
            const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
            if (outAlpha <= 0) {
                continue;
            }
            layer.data[destPos] = Math.round(
                (overlay.data[sourcePos] * sourceAlpha + layer.data[destPos] * destAlpha * (1 - sourceAlpha)) / outAlpha,
            );
            layer.data[destPos + 1] = Math.round(
                (overlay.data[sourcePos + 1] * sourceAlpha + layer.data[destPos + 1] * destAlpha * (1 - sourceAlpha)) /
                    outAlpha,
            );
            layer.data[destPos + 2] = Math.round(
                (overlay.data[sourcePos + 2] * sourceAlpha + layer.data[destPos + 2] * destAlpha * (1 - sourceAlpha)) /
                    outAlpha,
            );
            layer.data[destPos + 3] = Math.round(outAlpha * 255);
        }
    }
}
