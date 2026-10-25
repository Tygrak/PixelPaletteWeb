// Port of PixelPalette/Algorithm/ColorAdjustments.cs

import { colorToHsl, hslToColor } from '../shared/color';
import { colorArrayFromImage, createEmptyImage, setPixel } from '../shared/image';

// Inverts the RGB channels of every pixel (alpha is preserved, so transparent
// areas stay transparent).
export function invertImage(img: ImageData): ImageData {
    const result = createEmptyImage(img.width, img.height);
    const source = img.data;
    const target = result.data;
    for (let i = 0; i < source.length; i += 4) {
        target[i] = 255 - source[i];
        target[i + 1] = 255 - source[i + 1];
        target[i + 2] = 255 - source[i + 2];
        target[i + 3] = source[i + 3];
    }
    return result;
}

// Replaces every pixel with its grayscale luminance (alpha is preserved).
export function grayscaleImage(img: ImageData): ImageData {
    const result = createEmptyImage(img.width, img.height);
    const source = img.data;
    const target = result.data;
    for (let i = 0; i < source.length; i += 4) {
        const gray = Math.round(0.299 * source[i] + 0.587 * source[i + 1] + 0.114 * source[i + 2]);
        target[i] = gray;
        target[i + 1] = gray;
        target[i + 2] = gray;
        target[i + 3] = source[i + 3];
    }
    return result;
}

export function shiftHsl(img: ImageData, hueShift: number, saturation: number, lightness: number): ImageData {
    const colors = colorArrayFromImage(img);
    const result = createEmptyImage(img.width, img.height);
    for (let x = 0; x < img.width; x++) {
        for (let y = 0; y < img.height; y++) {
            const hsl = colorToHsl(colors[x + y * img.width]);
            hsl.h = Math.max(hsl.h + hueShift, 0) % 360;
            hsl.s = Math.min(Math.max(hsl.s * (1 + saturation), 0), 1);
            hsl.l = Math.min(Math.max(hsl.l * (1 + lightness), 0), 1);
            setPixel(result, x, y, hslToColor(hsl));
        }
    }
    return result;
}

// Separable Gaussian blur. Works on premultiplied alpha and blurs the alpha
// channel too, so transparent pixels contribute no color and edges fade out
// instead of turning into opaque black.
export function blurImage(img: ImageData, sigma: number): ImageData {
    const width = img.width;
    const height = img.height;
    const result = createEmptyImage(width, height);
    if (width === 0 || height === 0) {
        return result;
    }
    if (!(sigma > 0)) {
        result.data.set(img.data);
        return result;
    }
    // Kernel for offsets 0..radius-1, applied symmetrically. Normalizing it
    // keeps a constant region exactly constant despite the truncated tails.
    const radius = Math.max(1, Math.trunc(1 + sigma * 2));
    const kernel = new Float32Array(radius);
    let total = 0;
    for (let i = 0; i < radius; i++) {
        kernel[i] = Math.exp(-(i * i) / (2 * sigma * sigma));
        total += i === 0 ? kernel[i] : kernel[i] * 2;
    }
    for (let i = 0; i < radius; i++) {
        kernel[i] /= total;
    }

    // Premultiplied RGBA (alpha stored as 0..1), so transparent pixels carry
    // no color weight.
    const count = width * height;
    const source = new Float32Array(count * 4);
    const horizontal = new Float32Array(count * 4);
    const src = img.data;
    for (let i = 0; i < count; i++) {
        const p = i * 4;
        const alpha = src[p + 3] / 255;
        source[p] = src[p] * alpha;
        source[p + 1] = src[p + 1] * alpha;
        source[p + 2] = src[p + 2] * alpha;
        source[p + 3] = alpha;
    }

    const taps = radius * 2 - 1;
    for (let y = 0; y < height; y++) {
        const row = y * width;
        for (let x = 0; x < width; x++) {
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            for (let tap = 0; tap < taps; tap++) {
                const offset = tap - radius + 1;
                const sx = x + offset < 0 ? 0 : x + offset >= width ? width - 1 : x + offset;
                const weight = kernel[Math.abs(offset)];
                const sp = (row + sx) * 4;
                r += source[sp] * weight;
                g += source[sp + 1] * weight;
                b += source[sp + 2] * weight;
                a += source[sp + 3] * weight;
            }
            const dp = (row + x) * 4;
            horizontal[dp] = r;
            horizontal[dp + 1] = g;
            horizontal[dp + 2] = b;
            horizontal[dp + 3] = a;
        }
    }

    const out = result.data;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let r = 0;
            let g = 0;
            let b = 0;
            let a = 0;
            for (let tap = 0; tap < taps; tap++) {
                const offset = tap - radius + 1;
                const sy = y + offset < 0 ? 0 : y + offset >= height ? height - 1 : y + offset;
                const weight = kernel[Math.abs(offset)];
                const sp = (sy * width + x) * 4;
                r += horizontal[sp] * weight;
                g += horizontal[sp + 1] * weight;
                b += horizontal[sp + 2] * weight;
                a += horizontal[sp + 3] * weight;
            }
            const dp = (y * width + x) * 4;
            out[dp + 3] = a * 255;
            if (a > 0) {
                // Un-premultiply; Uint8ClampedArray rounds and clamps.
                out[dp] = r / a;
                out[dp + 1] = g / a;
                out[dp + 2] = b / a;
            }
        }
    }
    return result;
}
