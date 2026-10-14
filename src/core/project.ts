// Project files: the app's own save format for "work in progress", as opposed
// to the image exports in saveDialog. A project holds every frame, every
// layer's pixels, the palette and the foreground color, so the whole session
// can be restored where it was left off.
//
// The format is a small binary container so layer PNGs are stored as-is
// instead of being inflated by base64 (+33%) inside JSON:
//
//   bytes 0..3   "PPAL" magic
//   bytes 4..7   uint32 LE format version (2)
//   bytes 8..11  uint32 LE manifest length
//   next         manifest JSON (UTF-8): dimensions, frames/layers (with an
//                imageIndex each), the image byte lengths, palette/foreground
//   rest         the PNG blobs back to back
//
// Identical images (e.g. a duplicated layer) share one blob. The original
// image the document was opened from is deliberately NOT stored: a second full
// copy roughly doubled the file size, so on load Restore targets the saved
// state instead.
//
// The same serializer backs the downloaded .pixelpalette files and the
// automatic recent-files saves (core/recentFiles.ts, IndexedDB).

import { rgb, RGB } from '../shared/color';
import { downloadBlob, imageDataFromBlob, imageDataToPngDataUrl } from '../shared/files';
import { brushById } from './brushLibrary';
import { compositeLayers, createLayer, Layer } from './layers';
import {
    MAX_SYMMETRY_SEGMENTS,
    MIN_SYMMETRY_SEGMENTS,
    PaletteLockState,
    SymmetryState,
} from './modifiers';
import type { DocumentData, Store } from './store';

export const PROJECT_FORMAT = 'pixelpalette';
export const PROJECT_VERSION = 2;
export const PROJECT_EXTENSION = '.pixelpalette';

// "PPAL"
const MAGIC_A = 0x50;
const MAGIC_B = 0x50;
const MAGIC_C = 0x41;
const MAGIC_D = 0x4c;
const HEADER_BYTES = 12;

export interface ProjectLayer {
    name: string;
    visible: boolean;
    opacity: number;
    offsetX: number;
    offsetY: number;
    imageIndex: number;
}

export interface ProjectFrame {
    activeIndex: number;
    layers: ProjectLayer[];
}

export interface ProjectManifest {
    format: typeof PROJECT_FORMAT;
    version: number;
    width: number;
    height: number;
    frameIndex: number;
    frames: ProjectFrame[];
    imageLengths: number[];
    palette: RGB[];
    initialPalette: RGB[];
    foreground: RGB;
    // Selected brush and size (optional: files written before they were stored
    // lack them and keep the current session's brush).
    brushId?: string;
    brushSize?: number;
    // Drawing modifiers (optional: files written before they were stored lack
    // them and fall back to the current session's state).
    symmetry?: SymmetryState;
    paletteLock?: PaletteLockState;
}

function clampByte(value: number): number {
    return Math.max(0, Math.min(255, Math.round(value)));
}

function sanitizeColor(value: unknown): RGB | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const { r, g, b } = value as { r?: unknown; g?: unknown; b?: unknown };
    if (typeof r !== 'number' || typeof g !== 'number' || typeof b !== 'number') {
        return null;
    }
    return { r: clampByte(r), g: clampByte(g), b: clampByte(b) };
}

function sanitizePalette(value: unknown): RGB[] {
    if (!Array.isArray(value)) {
        return [];
    }
    const colors: RGB[] = [];
    for (const entry of value) {
        const color = sanitizeColor(entry);
        if (color) {
            colors.push(color);
        }
    }
    return colors;
}

function sanitizeLayerName(value: unknown): string {
    return typeof value === 'string' && value.trim() !== '' ? value : 'Layer';
}

// Modifier state is validated defensively (the manifest comes from a file).
function sanitizeSymmetry(value: unknown): SymmetryState | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const state = value as Partial<SymmetryState>;
    if (typeof state.cx !== 'number' || typeof state.cy !== 'number' || typeof state.angle !== 'number') {
        return null;
    }
    return {
        enabled: state.enabled === true,
        mode: state.mode === 'rotational' ? 'rotational' : 'mirror',
        cx: state.cx,
        cy: state.cy,
        angle: state.angle,
        length: typeof state.length === 'number' && state.length > 0 ? state.length : 0,
        segments:
            typeof state.segments === 'number'
                ? Math.max(MIN_SYMMETRY_SEGMENTS, Math.min(Math.round(state.segments), MAX_SYMMETRY_SEGMENTS))
                : MIN_SYMMETRY_SEGMENTS,
        // The guide transform mode is a transient editing state, never restored.
        transformMode: false,
    };
}

function sanitizePaletteLock(value: unknown): PaletteLockState | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const state = value as Partial<PaletteLockState>;
    return {
        enabled: state.enabled === true,
        applyOnPaletteChange: state.applyOnPaletteChange === true,
    };
}

// A brush id that still exists in the library (custom brushes may have been
// deleted since the file was written; the store falls back to the default).
function sanitizeBrushId(value: unknown): string | null {
    return typeof value === 'string' && brushById(value).id === value ? value : null;
}

function sanitizeBrushSize(value: unknown): number | null {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return null;
    }
    return Math.max(1, Math.min(500, Math.round(value)));
}

function dataUrlToBytes(url: string): Uint8Array<ArrayBuffer> {
    const comma = url.indexOf(',');
    const binary = atob(comma >= 0 ? url.slice(comma + 1) : url);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// Serializes the whole document (all frames/layers) into a project blob.
export function encodeProject(store: Store): Blob {
    const images: string[] = [];
    const imageIndices = new Map<string, number>();
    // Layers with pixel-identical images (duplicated layers, the background
    // copied around, ...) all point at the same blob.
    const addImage = (image: ImageData): number => {
        const dataUrl = imageDataToPngDataUrl(image);
        const existing = imageIndices.get(dataUrl);
        if (existing !== undefined) {
            return existing;
        }
        imageIndices.set(dataUrl, images.length);
        images.push(dataUrl);
        return images.length - 1;
    };
    const frames: ProjectFrame[] = [];
    for (let i = 0; i < store.frameCount; i++) {
        const layers: ProjectLayer[] = store.frameLayers(i).map((layer) => ({
            name: layer.name,
            visible: layer.visible,
            opacity: layer.opacity,
            offsetX: layer.offsetX,
            offsetY: layer.offsetY,
            imageIndex: addImage(layer.image),
        }));
        frames.push({ activeIndex: store.frameActiveIndex(i), layers });
    }
    const imageBytes = images.map(dataUrlToBytes);
    const manifest: ProjectManifest = {
        format: PROJECT_FORMAT,
        version: PROJECT_VERSION,
        width: store.width,
        height: store.height,
        frameIndex: store.currentFrame,
        frames,
        imageLengths: imageBytes.map((bytes) => bytes.length),
        palette: store.palette.map((color) => ({ ...color })),
        initialPalette: store.initialPalette.map((color) => ({ ...color })),
        foreground: { ...store.foreground },
        brushId: store.brushId,
        brushSize: store.brushSize,
        // The guide transform mode is transient editing state, not saved.
        symmetry: { ...store.symmetry, transformMode: false },
        paletteLock: { ...store.paletteLock },
    };
    const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
    const header = new Uint8Array(HEADER_BYTES);
    header[0] = MAGIC_A;
    header[1] = MAGIC_B;
    header[2] = MAGIC_C;
    header[3] = MAGIC_D;
    const view = new DataView(header.buffer);
    view.setUint32(4, PROJECT_VERSION, true);
    view.setUint32(8, manifestBytes.length, true);
    return new Blob([header, manifestBytes, ...imageBytes], { type: 'application/octet-stream' });
}

// Decodes a project into a store document snapshot. Returns null when the
// data is not a readable project.
export async function decodeProject(source: Blob): Promise<DocumentData | null> {
    try {
        const bytes = new Uint8Array(await source.arrayBuffer());
        if (!isBinaryProject(bytes)) {
            return null;
        }
        return await decodeBinaryProject(bytes);
    } catch {
        return null;
    }
}

function isBinaryProject(bytes: Uint8Array): boolean {
    return (
        bytes.length >= HEADER_BYTES &&
        bytes[0] === MAGIC_A &&
        bytes[1] === MAGIC_B &&
        bytes[2] === MAGIC_C &&
        bytes[3] === MAGIC_D
    );
}

async function decodeBinaryProject(bytes: Uint8Array<ArrayBuffer>): Promise<DocumentData | null> {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = view.getUint32(4, true);
    if (version < 1 || version > PROJECT_VERSION) {
        return null;
    }
    const manifestLength = view.getUint32(8, true);
    if (HEADER_BYTES + manifestLength > bytes.length) {
        return null;
    }
    const manifest = JSON.parse(
        new TextDecoder().decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + manifestLength)),
    ) as Partial<ProjectManifest>;
    if (
        manifest.format !== PROJECT_FORMAT ||
        !Array.isArray(manifest.frames) ||
        manifest.frames.length === 0 ||
        !Array.isArray(manifest.imageLengths)
    ) {
        return null;
    }
    // Decode each PNG blob (they follow the manifest back to back).
    const images: (ImageData | null)[] = [];
    let offset = HEADER_BYTES + manifestLength;
    for (const length of manifest.imageLengths) {
        if (typeof length !== 'number' || length < 0 || offset + length > bytes.length) {
            return null;
        }
        const blob = new Blob([bytes.subarray(offset, offset + length)], { type: 'image/png' });
        images.push(await imageDataFromBlob(blob));
        offset += length;
    }
    const frames: DocumentData['frames'] = [];
    for (const frame of manifest.frames) {
        const layers: Layer[] = [];
        for (const saved of Array.isArray(frame?.layers) ? frame.layers : []) {
            const pixels = typeof saved.imageIndex === 'number' ? (images[saved.imageIndex] ?? null) : null;
            if (!pixels) {
                continue;
            }
            const layer = createLayer(pixels.width, pixels.height, sanitizeLayerName(saved.name), pixels);
            layer.visible = saved.visible !== false;
            layer.opacity = typeof saved.opacity === 'number' ? Math.max(0, Math.min(1, saved.opacity)) : 1;
            layer.offsetX = typeof saved.offsetX === 'number' ? Math.round(saved.offsetX) : 0;
            layer.offsetY = typeof saved.offsetY === 'number' ? Math.round(saved.offsetY) : 0;
            layers.push(layer);
        }
        frames.push({
            layers,
            activeIndex: typeof frame?.activeIndex === 'number' ? Math.round(frame.activeIndex) : 0,
        });
    }
    const width = Math.max(1, Math.round(manifest.width ?? 1));
    const height = Math.max(1, Math.round(manifest.height ?? 1));
    const frameIndex = Math.max(0, Math.round(manifest.frameIndex ?? 0) || 0);
    const palette = sanitizePalette(manifest.palette);
    if (palette.length === 0) {
        palette.push(rgb(0, 0, 0), rgb(255, 255, 255));
    }
    let initialPalette = sanitizePalette(manifest.initialPalette);
    if (initialPalette.length === 0) {
        initialPalette = palette.map((color) => ({ ...color }));
    }
    const foreground = sanitizeColor(manifest.foreground) ?? { ...palette[0] };
    // The original image is not stored; Restore returns to the saved state.
    const currentLayers = frames[Math.min(frameIndex, frames.length - 1)]?.layers ?? [];
    const initial = currentLayers.some((layer) => layer.visible && layer.opacity > 0)
        ? compositeLayers(currentLayers, width, height)
        : null;
    const symmetry = sanitizeSymmetry(manifest.symmetry);
    if (symmetry && symmetry.length <= 0) {
        // Files without a guide length (or with a broken one) span the document.
        symmetry.length = Math.max(width, height);
    }
    return {
        width,
        height,
        frameIndex,
        frames,
        palette,
        initialPalette,
        initial,
        foreground,
        brushId: sanitizeBrushId(manifest.brushId) ?? undefined,
        brushSize: sanitizeBrushSize(manifest.brushSize) ?? undefined,
        symmetry: symmetry ?? undefined,
        paletteLock: sanitizePaletteLock(manifest.paletteLock) ?? undefined,
    };
}

// Downloads a project as the app's own file type.
export function downloadProjectFile(blob: Blob, name: string): void {
    downloadBlob(blob, `${name}${PROJECT_EXTENSION}`);
}

export function isProjectFileName(name: string): boolean {
    return name.toLowerCase().endsWith(PROJECT_EXTENSION);
}

// The file name without the project extension (used as the document name).
export function projectBaseName(name: string): string {
    return isProjectFileName(name) ? name.slice(0, -PROJECT_EXTENSION.length) : name;
}
