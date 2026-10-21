// Drop shadow: turns an image's non-transparent pixels into a colored,
// optionally blurred silhouette and composites it behind the source. Shared by
// the Adjustments panel effect and the Text tool's shadow option.

import { RGB } from '../shared/color';
import { createEmptyImage } from '../shared/image';

export interface ShadowOptions {
    color: RGB;
    // Shadow offset in document pixels.
    offsetX: number;
    offsetY: number;
    // Gaussian softness of the shadow edge, in pixels (0 = hard edge).
    blur: number;
    // 0..1 strength of the shadow.
    opacity: number;
}

// Colored silhouette of the image's non-transparent pixels, shifted by the
// offset and blurred by `blur`; transparent everywhere else.
export function shadowSilhouette(source: ImageData, options: ShadowOptions): ImageData {
    const width = source.width;
    const height = source.height;
    const alpha = new Float32Array(width * height);
    const offsetX = Math.round(options.offsetX);
    const offsetY = Math.round(options.offsetY);
    for (let y = 0; y < height; y++) {
        const destY = y + offsetY;
        if (destY < 0 || destY >= height) {
            continue;
        }
        for (let x = 0; x < width; x++) {
            const a = source.data[(x + y * width) * 4 + 3] / 255;
            if (a <= 0) {
                continue;
            }
            const destX = x + offsetX;
            if (destX < 0 || destX >= width) {
                continue;
            }
            const index = destX + destY * width;
            if (a > alpha[index]) {
                alpha[index] = a;
            }
        }
    }
    const soft = options.blur > 0 ? blurAlpha(alpha, width, height, options.blur) : alpha;
    const out = createEmptyImage(width, height);
    const opacity = Math.max(0, Math.min(1, options.opacity));
    for (let i = 0; i < soft.length; i++) {
        const a = Math.min(1, soft[i]) * opacity;
        if (a <= 0) {
            continue;
        }
        const pos = i * 4;
        out.data[pos] = options.color.r;
        out.data[pos + 1] = options.color.g;
        out.data[pos + 2] = options.color.b;
        out.data[pos + 3] = Math.round(a * 255);
    }
    return out;
}

// The source image with its shadow composited behind it.
export function withDropShadow(source: ImageData, options: ShadowOptions): ImageData {
    const shadow = shadowSilhouette(source, options);
    const out = createEmptyImage(source.width, source.height);
    out.data.set(shadow.data);
    compositeOver(out, source);
    return out;
}

// Source-over composite of `source` onto `target` (same size, document space).
function compositeOver(target: ImageData, source: ImageData): void {
    const dest = target.data;
    const src = source.data;
    for (let pos = 0; pos < src.length; pos += 4) {
        const sourceAlpha = src[pos + 3] / 255;
        if (sourceAlpha <= 0) {
            continue;
        }
        if (sourceAlpha >= 1) {
            dest[pos] = src[pos];
            dest[pos + 1] = src[pos + 1];
            dest[pos + 2] = src[pos + 2];
            dest[pos + 3] = 255;
            continue;
        }
        const destAlpha = dest[pos + 3] / 255;
        const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
        if (outAlpha <= 0) {
            continue;
        }
        dest[pos] = Math.round((src[pos] * sourceAlpha + dest[pos] * destAlpha * (1 - sourceAlpha)) / outAlpha);
        dest[pos + 1] = Math.round(
            (src[pos + 1] * sourceAlpha + dest[pos + 1] * destAlpha * (1 - sourceAlpha)) / outAlpha,
        );
        dest[pos + 2] = Math.round(
            (src[pos + 2] * sourceAlpha + dest[pos + 2] * destAlpha * (1 - sourceAlpha)) / outAlpha,
        );
        dest[pos + 3] = Math.round(outAlpha * 255);
    }
}

// Separable Gaussian blur of a single-channel buffer (edge pixels clamp).
function blurAlpha(source: Float32Array, width: number, height: number, sigma: number): Float32Array {
    const range = Math.max(1, Math.trunc(1 + sigma * 2));
    const c = 1 / Math.sqrt(sigma * sigma * 2 * Math.PI);
    const kernel = new Array<number>(range);
    for (let i = 0; i < range; i++) {
        kernel[i] = Math.exp(-(i * i) / (2 * sigma * sigma)) * c;
    }
    const horizontal = new Float32Array(source.length);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let sum = 0;
            for (let i = x - range + 1; i < x + range; i++) {
                const clampedX = i < 0 ? 0 : i >= width ? width - 1 : i;
                sum += source[clampedX + y * width] * kernel[Math.abs(x - i)];
            }
            horizontal[x + y * width] = sum;
        }
    }
    const out = new Float32Array(source.length);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let sum = 0;
            for (let i = y - range + 1; i < y + range; i++) {
                const clampedY = i < 0 ? 0 : i >= height ? height - 1 : i;
                sum += horizontal[x + clampedY * width] * kernel[Math.abs(y - i)];
            }
            out[x + y * width] = sum;
        }
    }
    return out;
}
