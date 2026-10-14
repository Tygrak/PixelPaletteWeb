// Animated GIF export: builds one shared palette from every frame's composite
// and encodes a looping GIF. Pixel art usually has few enough colors that the
// palette can be exact; busier animations are quantized with median cut and
// the pixels are snapped to the nearest palette entry.

import { distinctColors, RGB } from '../shared/color';
import { encodeGif, GifFrameData } from '../shared/gif';
import { createPaletteSnap } from './modifiers';
import { medianCut } from './palette';
import type { Store } from './store';

// GIF supports 256 colors; one slot is always reserved for transparency.
const MAX_COLORS = 255;
// Pixels below this alpha become the GIF's transparent index.
const ALPHA_THRESHOLD = 128;
// Cap for the median-cut sample so quantization stays fast on large canvases.
const MAX_SAMPLES = 65536;

function quantize(images: ImageData[]): RGB[] {
    let total = 0;
    for (const image of images) {
        total += image.width * image.height;
    }
    const stride = Math.max(1, Math.ceil(total / MAX_SAMPLES));
    const samples: number[] = [];
    for (const image of images) {
        const data = image.data;
        let index = 0;
        for (let i = 0; i < data.length; i += 4, index++) {
            if (index % stride !== 0 || data[i + 3] < ALPHA_THRESHOLD) {
                continue;
            }
            samples.push(data[i], data[i + 1], data[i + 2], 255);
        }
    }
    if (samples.length === 0) {
        return [];
    }
    const sample = new ImageData(samples.length / 4, 1);
    sample.data.set(samples);
    return distinctColors(medianCut(sample, MAX_COLORS));
}

// Encodes every frame of the current document as a looping animated GIF.
// Returns null when there is nothing to animate.
export function exportAnimationGif(store: Store, fps: number): Blob | null {
    const width = store.width;
    const height = store.height;
    if (width <= 0 || height <= 0 || store.frameCount < 2) {
        return null;
    }
    const images: ImageData[] = [];
    for (let i = 0; i < store.frameCount; i++) {
        const composite = store.frameComposite(i);
        if (composite) {
            images.push(composite);
        }
    }
    if (images.length < 2) {
        return null;
    }

    // First pass: collect the exact colors while there are few enough for GIF.
    // Busy animations bail out early and are quantized instead.
    const unique = new Set<number>();
    let exact = true;
    outer: for (const image of images) {
        const data = image.data;
        for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] < ALPHA_THRESHOLD) {
                continue;
            }
            unique.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
            if (unique.size > MAX_COLORS) {
                exact = false;
                break outer;
            }
        }
    }
    let palette: RGB[];
    if (exact) {
        palette = [...unique].map((key) => ({
            r: (key >> 16) & 0xff,
            g: (key >> 8) & 0xff,
            b: key & 0xff,
        }));
    } else {
        palette = quantize(images);
    }
    if (palette.length === 0) {
        palette = [{ r: 0, g: 0, b: 0 }];
    }
    const transparentIndex = palette.length;

    const exactIndices = new Map<number, number>();
    palette.forEach((color, index) => {
        exactIndices.set((color.r << 16) | (color.g << 8) | color.b, index);
    });
    const snap = createPaletteSnap(palette);

    const delayCs = Math.max(2, Math.round(100 / Math.max(1, fps)));
    const frames: GifFrameData[] = images.map((image) => {
        const data = image.data;
        const pixels = new Uint8Array(image.width * image.height);
        for (let p = 0, i = 0; i < data.length; i += 4, p++) {
            if (data[i + 3] < ALPHA_THRESHOLD) {
                pixels[p] = transparentIndex;
                continue;
            }
            const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
            const found = exactIndices.get(key);
            pixels[p] = found !== undefined ? found : snap.index(data[i], data[i + 1], data[i + 2]);
        }
        return { pixels, delayCs };
    });
    return encodeGif(width, height, palette, transparentIndex, frames);
}
