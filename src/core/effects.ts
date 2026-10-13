// Edge detection effect (Sobel gradient + hysteresis thresholds + dilation).

import { clamp, RGB } from '../shared/color';
import { createEmptyImage } from '../shared/image';

export interface EdgeDetectionOptions {
    // How many pixels wide the detected edges are drawn (1 = thin).
    width: number;
    // Gradient magnitude thresholds (0-255, normalized Sobel magnitude).
    lowThreshold: number;
    highThreshold: number;
    edgeColor: RGB;
    // null keeps the original image behind the edges.
    background: RGB | null;
    // When true, lowThreshold/highThreshold are estimated from the image.
    autoThresholds: boolean;
}

export interface EdgeDetectionResult {
    image: ImageData;
    lowThreshold: number;
    highThreshold: number;
}

// Maximum single-axis Sobel response for an 8-bit step edge (4 * 255), used
// to normalize the gradient magnitude into a stable 0-255 range. With this
// scale the normalized value roughly equals the local intensity difference.
const SOBEL_NORMALIZE = 1020;
const NORMALIZE_SCALE = 255 / SOBEL_NORMALIZE;

// Auto-threshold tuning. Thresholds are derived from the mean and standard
// deviation of the gradient magnitude: uniform/slow gradients have a high
// mean but near-zero deviation, so they stay below the threshold, while real
// edges stand out as deviations above the mean.
const AUTO_STD_FACTOR = 1;
const AUTO_MARGIN = 1;
const AUTO_MIN_EDGE = 10;
const AUTO_LOW_RATIO = 0.4;

function autoThresholds(magnitude: Float32Array): { lowThreshold: number; highThreshold: number } {
    const count = magnitude.length;
    let sum = 0;
    let sumSquares = 0;
    for (let i = 0; i < count; i++) {
        const value = Math.min(255, magnitude[i] * NORMALIZE_SCALE);
        sum += value;
        sumSquares += value * value;
    }
    const mean = sum / count;
    const variance = Math.max(0, sumSquares / count - mean * mean);
    const std = Math.sqrt(variance);
    const high = clamp(Math.round(mean + AUTO_STD_FACTOR * std + AUTO_MARGIN), AUTO_MIN_EDGE, 255);
    const low = clamp(Math.round(high * AUTO_LOW_RATIO), 1, 255);
    return { lowThreshold: low, highThreshold: high };
}

function grayscale(img: ImageData): Float32Array {
    const count = img.width * img.height;
    const gray = new Float32Array(count);
    for (let i = 0; i < count; i++) {
        const p = i * 4;
        gray[i] = 0.299 * img.data[p] + 0.587 * img.data[p + 1] + 0.114 * img.data[p + 2];
    }
    return gray;
}

function sobelMagnitude(gray: Float32Array, width: number, height: number): Float32Array {
    const magnitude = new Float32Array(width * height);
    const at = (x: number, y: number): number => {
        const cx = clamp(x, 0, width - 1);
        const cy = clamp(y, 0, height - 1);
        return gray[cx + cy * width];
    };
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const tl = at(x - 1, y - 1);
            const t = at(x, y - 1);
            const tr = at(x + 1, y - 1);
            const l = at(x - 1, y);
            const r = at(x + 1, y);
            const bl = at(x - 1, y + 1);
            const b = at(x, y + 1);
            const br = at(x + 1, y + 1);
            const gx = tr + 2 * r + br - (tl + 2 * l + bl);
            const gy = bl + 2 * b + br - (tl + 2 * t + tr);
            magnitude[x + y * width] = Math.hypot(gx, gy);
        }
    }
    return magnitude;
}

// Keeps weak edges only when connected to a strong edge (hysteresis).
function hysteresis(strong: Uint8Array, weak: Uint8Array, width: number, height: number): Uint8Array {
    const keep = Uint8Array.from(strong);
    const stack: number[] = [];
    for (let i = 0; i < strong.length; i++) {
        if (strong[i]) {
            stack.push(i);
        }
    }
    while (stack.length > 0) {
        const index = stack.pop()!;
        const x = index % width;
        const y = (index / width) | 0;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) {
                    continue;
                }
                const nx = x + dx;
                const ny = y + dy;
                if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
                    continue;
                }
                const neighbor = nx + ny * width;
                if (weak[neighbor] && !keep[neighbor]) {
                    keep[neighbor] = 1;
                    stack.push(neighbor);
                }
            }
        }
    }
    return keep;
}

function dilate(source: Uint8Array, width: number, height: number): Uint8Array {
    const result = new Uint8Array(source.length);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            let value = 0;
            for (let dy = -1; dy <= 1 && value === 0; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
                        continue;
                    }
                    if (source[nx + ny * width]) {
                        value = 1;
                        break;
                    }
                }
            }
            result[x + y * width] = value;
        }
    }
    return result;
}

export function detectEdges(img: ImageData, options: EdgeDetectionOptions): EdgeDetectionResult {
    const width = img.width;
    const height = img.height;
    const edgeWidth = Math.max(1, Math.round(options.width));

    const magnitude = sobelMagnitude(grayscale(img), width, height);
    const thresholds = options.autoThresholds
        ? autoThresholds(magnitude)
        : {
                lowThreshold: clamp(options.lowThreshold, 0, 255),
                highThreshold: clamp(options.highThreshold, 0, 255),
            };
    const { lowThreshold: low, highThreshold: high } = thresholds;

    const strong = new Uint8Array(width * height);
    const weak = new Uint8Array(width * height);
    for (let i = 0; i < magnitude.length; i++) {
        const value = Math.min(255, magnitude[i] * NORMALIZE_SCALE);
        if (value >= high) {
            strong[i] = 1;
        } else if (value >= low) {
            weak[i] = 1;
        }
    }

    let mask = hysteresis(strong, weak, width, height);
    for (let i = 1; i < edgeWidth; i++) {
        mask = dilate(mask, width, height);
    }

    const result = createEmptyImage(width, height);
    const { edgeColor, background } = options;
    for (let i = 0; i < width * height; i++) {
        const p = i * 4;
        if (mask[i]) {
            result.data[p] = edgeColor.r;
            result.data[p + 1] = edgeColor.g;
            result.data[p + 2] = edgeColor.b;
        } else if (background) {
            result.data[p] = background.r;
            result.data[p + 1] = background.g;
            result.data[p + 2] = background.b;
        } else {
            result.data[p] = img.data[p];
            result.data[p + 1] = img.data[p + 1];
            result.data[p + 2] = img.data[p + 2];
        }
        result.data[p + 3] = 255;
    }
    return { image: result, lowThreshold: low, highThreshold: high };
}
