// Layer model and compositing (source-over alpha blending). Layers form a
// tree: a group holds children (layers and other groups), so groups can nest.
// The arrays are ordered bottom to top (index 0 is drawn first).

import { cloneImage, createEmptyImage } from '../shared/image';

export interface Layer {
    kind: 'layer';
    id: number;
    name: string;
    image: ImageData;
    visible: boolean;
    opacity: number;
    offsetX: number;
    offsetY: number;
}

export interface LayerGroup {
    kind: 'group';
    id: number;
    name: string;
    visible: boolean;
    // Blends the group's children as one unit (0..1).
    opacity: number;
    children: LayerNode[];
}

export type LayerNode = Layer | LayerGroup;

export function isLayer(node: LayerNode): node is Layer {
    return node.kind === 'layer';
}

export function isGroup(node: LayerNode): node is LayerGroup {
    return node.kind === 'group';
}

let nextNodeId = 1;

export function createLayer(width: number, height: number, name: string, image?: ImageData): Layer {
    return {
        kind: 'layer',
        id: nextNodeId++,
        name,
        image: image ?? createEmptyImage(width, height),
        visible: true,
        opacity: 1,
        offsetX: 0,
        offsetY: 0,
    };
}

export function createGroup(name: string): LayerGroup {
    return { kind: 'group', id: nextNodeId++, name, visible: true, opacity: 1, children: [] };
}

// Clones the tree structure (new node objects and arrays) while sharing layer
// images: callers replace images rather than mutating them in place, so a
// snapshot's pixels stay intact (see store.beginPaint).
export function cloneNodes(nodes: LayerNode[]): LayerNode[] {
    return nodes.map((node) => (isGroup(node) ? { ...node, children: cloneNodes(node.children) } : { ...node }));
}

// Deep clone with fresh ids and copied pixels (duplicate layer/group).
export function duplicateNodes(nodes: LayerNode[]): LayerNode[] {
    return nodes.map((node) =>
        isGroup(node)
            ? { ...node, id: nextNodeId++, children: duplicateNodes(node.children) }
            : { ...node, id: nextNodeId++, image: cloneImage(node.image) },
    );
}

export function findNode(nodes: LayerNode[], id: number): LayerNode | null {
    for (const node of nodes) {
        if (node.id === id) {
            return node;
        }
        if (isGroup(node)) {
            const found = findNode(node.children, id);
            if (found) {
                return found;
            }
        }
    }
    return null;
}

// The group a node lives in, or null when it sits at the root.
export function findParent(nodes: LayerNode[], id: number): LayerGroup | null {
    for (const node of nodes) {
        if (!isGroup(node)) {
            continue;
        }
        if (node.children.some((child) => child.id === id)) {
            return node;
        }
        const found = findParent(node.children, id);
        if (found) {
            return found;
        }
    }
    return null;
}

export function containsNode(group: LayerGroup, id: number): boolean {
    return findNode(group.children, id) !== null;
}

// All layers in draw order (bottom to top, depth first).
export function flattenLayers(nodes: LayerNode[]): Layer[] {
    const layers: Layer[] = [];
    for (const node of nodes) {
        if (isLayer(node)) {
            layers.push(node);
        } else {
            layers.push(...flattenLayers(node.children));
        }
    }
    return layers;
}

// Visible layers in draw order; a hidden group hides its whole subtree.
export function flattenVisibleLayers(nodes: LayerNode[]): Layer[] {
    const layers: Layer[] = [];
    for (const node of nodes) {
        if (!node.visible) {
            continue;
        }
        if (isLayer(node)) {
            if (node.opacity > 0) {
                layers.push(node);
            }
        } else {
            layers.push(...flattenVisibleLayers(node.children));
        }
    }
    return layers;
}

// All nodes in display order (top first; a group before its children) — the
// order the Layers lists render and range selections use.
export function flattenDisplayNodes(nodes: LayerNode[], out: LayerNode[] = []): LayerNode[] {
    for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        out.push(node);
        if (isGroup(node)) {
            flattenDisplayNodes(node.children, out);
        }
    }
    return out;
}

// Replaces every layer in the tree through `map`, rebuilding the structure.
export function mapLayers(nodes: LayerNode[], map: (layer: Layer) => Layer): LayerNode[] {
    return nodes.map((node) =>
        isGroup(node)
            ? { ...node, children: mapLayers(node.children, map) }
            : map(node),
    );
}

export function compositeLayers(nodes: LayerNode[], width: number, height: number): ImageData {
    const visible = flattenVisibleLayers(nodes);
    if (visible.length === 0) {
        return createEmptyImage(width, height);
    }
    // A single opaque layer at the origin: the composite is that layer's image.
    const single = visible[0];
    if (
        nodes.length === 1 &&
        isLayer(nodes[0]) &&
        nodes[0] === single &&
        single.offsetX === 0 &&
        single.offsetY === 0 &&
        single.opacity >= 1
    ) {
        return single.image;
    }
    const out = createEmptyImage(width, height);
    compositeNodes(nodes, out, { x0: 0, y0: 0, x1: width, y1: height });
    return out;
}

// Recomputes just a document-space rectangle of an existing composite (built
// from the same nodes). Painting mutates one layer in place, so only the small
// area a stroke touched needs re-blending instead of the whole document. The
// math mirrors compositeLayers exactly (including its per-node rounding and
// group isolation) so patched regions are pixel-identical to a full rebuild.
export function compositeRegion(
    out: ImageData,
    nodes: LayerNode[],
    rectX: number,
    rectY: number,
    rectWidth: number,
    rectHeight: number,
): void {
    const rect = {
        x0: Math.max(0, Math.floor(rectX)),
        y0: Math.max(0, Math.floor(rectY)),
        x1: Math.min(out.width, Math.ceil(rectX + rectWidth)),
        y1: Math.min(out.height, Math.ceil(rectY + rectHeight)),
    };
    if (rect.x1 <= rect.x0 || rect.y1 <= rect.y0) {
        return;
    }
    const visible = flattenVisibleLayers(nodes);
    const outData = out.data;
    if (visible.length === 0) {
        for (let y = rect.y0; y < rect.y1; y++) {
            outData.fill(0, (rect.x0 + y * out.width) * 4, (rect.x1 + y * out.width) * 4);
        }
        return;
    }
    // Single opaque layer: the composite cache IS that layer's image, so the
    // region is already up to date.
    const single = visible[0];
    if (
        nodes.length === 1 &&
        isLayer(nodes[0]) &&
        nodes[0] === single &&
        single.offsetX === 0 &&
        single.offsetY === 0 &&
        single.opacity >= 1
    ) {
        return;
    }
    // Rebuild the region in a buffer covering it, then replace those pixels.
    const buffer = createEmptyImage(rect.x1 - rect.x0, rect.y1 - rect.y0);
    compositeNodes(nodes, buffer, rect);
    const bufferWidth = rect.x1 - rect.x0;
    for (let y = rect.y0; y < rect.y1; y++) {
        const sourceStart = (y - rect.y0) * bufferWidth * 4;
        outData.set(buffer.data.subarray(sourceStart, sourceStart + bufferWidth * 4), (rect.x0 + y * out.width) * 4);
    }
}

interface CompositeRect {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
}

// Composites nodes (bottom to top) into a buffer covering `rect`, in document
// coordinates. A group with partial opacity renders its children into its own
// buffer first and blends that as one unit, so overlapping children do not
// show through each other (true group isolation).
function compositeNodes(nodes: LayerNode[], buffer: ImageData, rect: CompositeRect): void {
    for (const node of nodes) {
        if (!node.visible || node.opacity <= 0) {
            continue;
        }
        if (isLayer(node)) {
            blendLayer(buffer, node, rect, 1);
            continue;
        }
        if (node.opacity >= 1) {
            compositeNodes(node.children, buffer, rect);
            continue;
        }
        const groupBuffer = createEmptyImage(rect.x1 - rect.x0, rect.y1 - rect.y0);
        compositeNodes(node.children, groupBuffer, rect);
        blendBuffer(buffer, groupBuffer, node.opacity);
    }
}

// Blends one layer's pixels into a rect-sized buffer (source-over). The buffer
// covers `rect` in document space; `multiplier` folds in enclosing opacities.
function blendLayer(buffer: ImageData, layer: Layer, rect: CompositeRect, multiplier: number): void {
    const opacity = layer.opacity * multiplier;
    if (opacity <= 0) {
        return;
    }
    const src = layer.image.data;
    const layerWidth = layer.image.width;
    const layerHeight = layer.image.height;
    const { offsetX, offsetY } = layer;
    const outData = buffer.data;
    const bufferWidth = buffer.width;
    const x0 = Math.max(rect.x0, offsetX);
    const x1 = Math.min(rect.x1, offsetX + layerWidth);
    const y0 = Math.max(rect.y0, offsetY);
    const y1 = Math.min(rect.y1, offsetY + layerHeight);
    for (let destY = y0; destY < y1; destY++) {
        const layerY = destY - offsetY;
        const bufferRow = (destY - rect.y0) * bufferWidth;
        for (let destX = x0; destX < x1; destX++) {
            const layerX = destX - offsetX;
            const sourcePos = (layerX + layerY * layerWidth) * 4;
            const sourceAlpha = (src[sourcePos + 3] / 255) * opacity;
            if (sourceAlpha <= 0) {
                continue;
            }
            const destPos = (destX - rect.x0 + bufferRow) * 4;
            if (sourceAlpha >= 1) {
                outData[destPos] = src[sourcePos];
                outData[destPos + 1] = src[sourcePos + 1];
                outData[destPos + 2] = src[sourcePos + 2];
                outData[destPos + 3] = 255;
                continue;
            }
            blendPixel(outData, destPos, src, sourcePos, sourceAlpha);
        }
    }
}

// Blends one rect-sized buffer into another with the same rect (used for
// translucent groups).
function blendBuffer(target: ImageData, source: ImageData, opacity: number): void {
    const targetData = target.data;
    const sourceData = source.data;
    for (let pos = 0; pos < sourceData.length; pos += 4) {
        const sourceAlpha = (sourceData[pos + 3] / 255) * opacity;
        if (sourceAlpha <= 0) {
            continue;
        }
        if (sourceAlpha >= 1) {
            targetData[pos] = sourceData[pos];
            targetData[pos + 1] = sourceData[pos + 1];
            targetData[pos + 2] = sourceData[pos + 2];
            targetData[pos + 3] = 255;
            continue;
        }
        blendPixel(targetData, pos, sourceData, pos, sourceAlpha);
    }
}

// Source-over blend of one pixel (unmultiplied RGBA).
function blendPixel(
    dest: Uint8ClampedArray,
    destPos: number,
    src: Uint8ClampedArray,
    sourcePos: number,
    sourceAlpha: number,
): void {
    const destAlpha = dest[destPos + 3] / 255;
    const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
    if (outAlpha <= 0) {
        return;
    }
    dest[destPos] = Math.round(
        (src[sourcePos] * sourceAlpha + dest[destPos] * destAlpha * (1 - sourceAlpha)) / outAlpha,
    );
    dest[destPos + 1] = Math.round(
        (src[sourcePos + 1] * sourceAlpha + dest[destPos + 1] * destAlpha * (1 - sourceAlpha)) / outAlpha,
    );
    dest[destPos + 2] = Math.round(
        (src[sourcePos + 2] * sourceAlpha + dest[destPos + 2] * destAlpha * (1 - sourceAlpha)) / outAlpha,
    );
    dest[destPos + 3] = Math.round(outAlpha * 255);
}
