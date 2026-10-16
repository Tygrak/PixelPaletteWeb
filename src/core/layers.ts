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
    return { kind: 'group', id: nextNodeId++, name, visible: true, children: [] };
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
    const single = visible[0];
    if (
        visible.length === 1 &&
        single.offsetX === 0 &&
        single.offsetY === 0 &&
        single.opacity >= 1
    ) {
        return single.image;
    }

    const out = createEmptyImage(width, height);
    const outData = out.data;
    for (const layer of visible) {
        const src = layer.image.data;
        const layerWidth = layer.image.width;
        const layerHeight = layer.image.height;
        const { offsetX, offsetY, opacity } = layer;
        for (let y = 0; y < layerHeight; y++) {
            const destY = y + offsetY;
            if (destY < 0 || destY >= height) {
                continue;
            }
            for (let x = 0; x < layerWidth; x++) {
                const destX = x + offsetX;
                if (destX < 0 || destX >= width) {
                    continue;
                }
                const sourcePos = (x + y * layerWidth) * 4;
                const sourceAlpha = (src[sourcePos + 3] / 255) * opacity;
                if (sourceAlpha <= 0) {
                    continue;
                }
                const destPos = (destX + destY * width) * 4;
                if (sourceAlpha >= 1) {
                    // Fully opaque source: it simply replaces whatever was below.
                    outData[destPos] = src[sourcePos];
                    outData[destPos + 1] = src[sourcePos + 1];
                    outData[destPos + 2] = src[sourcePos + 2];
                    outData[destPos + 3] = 255;
                    continue;
                }
                const destAlpha = outData[destPos + 3] / 255;
                const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
                if (outAlpha <= 0) {
                    continue;
                }
                outData[destPos] = Math.round(
                    (src[sourcePos] * sourceAlpha + outData[destPos] * destAlpha * (1 - sourceAlpha)) / outAlpha,
                );
                outData[destPos + 1] = Math.round(
                    (src[sourcePos + 1] * sourceAlpha + outData[destPos + 1] * destAlpha * (1 - sourceAlpha)) / outAlpha,
                );
                outData[destPos + 2] = Math.round(
                    (src[sourcePos + 2] * sourceAlpha + outData[destPos + 2] * destAlpha * (1 - sourceAlpha)) / outAlpha,
                );
                outData[destPos + 3] = Math.round(outAlpha * 255);
            }
        }
    }
    return out;
}

// Recomputes just a document-space rectangle of an existing composite (built
// from the same nodes). Painting mutates one layer in place, so only the small
// area a stroke touched needs re-blending instead of the whole document. The
// math mirrors compositeLayers exactly (including its per-layer rounding) so
// patched regions are pixel-identical to a full rebuild.
export function compositeRegion(
    out: ImageData,
    nodes: LayerNode[],
    rectX: number,
    rectY: number,
    rectWidth: number,
    rectHeight: number,
): void {
    const visible = flattenVisibleLayers(nodes);
    const x0 = Math.max(0, Math.floor(rectX));
    const y0 = Math.max(0, Math.floor(rectY));
    const x1 = Math.min(out.width, Math.ceil(rectX + rectWidth));
    const y1 = Math.min(out.height, Math.ceil(rectY + rectHeight));
    if (x1 <= x0 || y1 <= y0) {
        return;
    }
    const outData = out.data;
    if (visible.length === 0) {
        for (let y = y0; y < y1; y++) {
            outData.fill(0, (x0 + y * out.width) * 4, (x1 + y * out.width) * 4);
        }
        return;
    }
    // Single opaque layer: the composite cache IS that layer's image, so the
    // region is already up to date.
    const single = visible[0];
    if (visible.length === 1 && single.offsetX === 0 && single.offsetY === 0 && single.opacity >= 1) {
        return;
    }
    // Clear the region, then blend each layer into it. Iterating layer-outer
    // keeps both reads and writes sequential (unlike a per-pixel layer loop),
    // which matters when a large region is patched.
    for (let y = y0; y < y1; y++) {
        outData.fill(0, (x0 + y * out.width) * 4, (x1 + y * out.width) * 4);
    }
    for (const layer of visible) {
        const src = layer.image.data;
        const layerWidth = layer.image.width;
        const layerHeight = layer.image.height;
        const { offsetX, offsetY, opacity } = layer;
        const layerX0 = Math.max(0, x0 - offsetX);
        const layerX1 = Math.min(layerWidth, x1 - offsetX);
        const layerY0 = Math.max(0, y0 - offsetY);
        const layerY1 = Math.min(layerHeight, y1 - offsetY);
        for (let layerY = layerY0; layerY < layerY1; layerY++) {
            const destY = layerY + offsetY;
            for (let layerX = layerX0; layerX < layerX1; layerX++) {
                const sourcePos = (layerX + layerY * layerWidth) * 4;
                const sourceAlpha = (src[sourcePos + 3] / 255) * opacity;
                if (sourceAlpha <= 0) {
                    continue;
                }
                const destPos = (layerX + offsetX + destY * out.width) * 4;
                if (sourceAlpha >= 1) {
                    // Fully opaque source: it simply replaces whatever was below.
                    outData[destPos] = src[sourcePos];
                    outData[destPos + 1] = src[sourcePos + 1];
                    outData[destPos + 2] = src[sourcePos + 2];
                    outData[destPos + 3] = 255;
                    continue;
                }
                const destAlpha = outData[destPos + 3] / 255;
                const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
                if (outAlpha <= 0) {
                    continue;
                }
                outData[destPos] = Math.round(
                    (src[sourcePos] * sourceAlpha + outData[destPos] * destAlpha * (1 - sourceAlpha)) / outAlpha,
                );
                outData[destPos + 1] = Math.round(
                    (src[sourcePos + 1] * sourceAlpha + outData[destPos + 1] * destAlpha * (1 - sourceAlpha)) / outAlpha,
                );
                outData[destPos + 2] = Math.round(
                    (src[sourcePos + 2] * sourceAlpha + outData[destPos + 2] * destAlpha * (1 - sourceAlpha)) / outAlpha,
                );
                outData[destPos + 3] = Math.round(outAlpha * 255);
            }
        }
    }
}
