// Port of PixelPalette/Algorithm/PaletteGeneration.cs

import {
    averageColors,
    getBrightness,
    getDistance,
    getHue,
    getMinDistanceIndex,
    hslToColor,
    RGB,
} from '../shared/color';
import { colorArrayFromImage, createEmptyImage, setPixel } from '../shared/image';

export function splitColors(colors: RGB[]): [RGB[], RGB[]] {
    const minColorChannels = [255, 255, 255];
    const maxColorChannels = [0, 0, 0];
    for (const color of colors) {
        const channels = [color.r, color.g, color.b];
        for (let i = 0; i < 3; i++) {
            if (channels[i] > maxColorChannels[i]) {
                maxColorChannels[i] = channels[i];
            }
            if (channels[i] < minColorChannels[i]) {
                minColorChannels[i] = channels[i];
            }
        }
    }
    let sortUsing = 0;
    for (let i = 1; i < 3; i++) {
        if (maxColorChannels[i] - minColorChannels[i] > maxColorChannels[sortUsing] - minColorChannels[sortUsing]) {
            sortUsing = i;
        }
    }
    if (sortUsing === 0) {
        colors.sort((a, b) => a.r - b.r);
    } else if (sortUsing === 1) {
        colors.sort((a, b) => a.g - b.g);
    } else {
        colors.sort((a, b) => a.b - b.b);
    }
    const half = Math.floor(colors.length / 2);
    return [colors.slice(0, half), colors.slice(half)];
}

function splitIntoGroups(colors: RGB[], count: number): RGB[][] {
    let groups: RGB[][] = [colors];
    while (groups.length * 2 <= count) {
        const nextGroups: RGB[][] = [];
        for (const pixels of groups) {
            const [first, second] = splitColors(pixels);
            nextGroups.push(first, second);
        }
        groups = nextGroups;
    }
    while (groups.length < count) {
        const last = groups[groups.length - 1];
        const [first, second] = splitColors(last);
        groups.pop();
        groups.push(first, second);
    }
    return groups;
}

export function medianCut(img: ImageData, count: number): RGB[] {
    const groups = splitIntoGroups(colorArrayFromImage(img), count);
    return groups.map((pixels) => averageColors(pixels));
}

export function sortColors(img: ImageData, count: number): ImageData {
    const groups = splitIntoGroups(colorArrayFromImage(img), count);
    const resColors: RGB[] = [];
    for (const pixels of groups) {
        resColors.push(...pixels);
    }
    const width = img.width;
    const height = img.height;
    const result = createEmptyImage(width, height);
    const band = Math.floor(height / count);
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            if (band > 0 && y > 0 && y % band === 0) {
                setPixel(result, x, y, { r: 0, g: 0, b: 0 });
            } else {
                setPixel(result, x, y, resColors[x + y * width] ?? { r: 0, g: 0, b: 0 });
            }
        }
    }
    return result;
}

export function kMeans(img: ImageData, count: number, maxSteps: number): RGB[] {
    const colors = colorArrayFromImage(img);
    const clusters = new Array<number>(colors.length).fill(0);
    const means: RGB[] = new Array(count);

    {
        const sorted = colors.slice().sort((a, b) => getHue(a) - getHue(b));
        const step = Math.floor(sorted.length / count);
        for (let i = 0; i < count; i++) {
            const index = Math.min(sorted.length - 1, i * step + Math.floor(step / 2));
            means[i] = sorted[index] ?? { r: 0, g: 0, b: 0 };
        }
    }

    let changed = false;
    for (let step = 0; step < maxSteps; step++) {
        for (let i = 0; i < colors.length; i++) {
            const newCluster = getMinDistanceIndex(colors[i], means);
            if (newCluster !== clusters[i]) {
                changed = true;
                clusters[i] = newCluster;
            }
        }
        if (!changed) {
            break;
        }
        changed = false;

        const clusterCounts = new Array<number>(count).fill(0);
        const clusterSums = Array.from({ length: count }, () => ({ r: 0, g: 0, b: 0 }));
        for (let i = 0; i < colors.length; i++) {
            const cluster = clusters[i];
            clusterCounts[cluster]++;
            clusterSums[cluster].r += colors[i].r;
            clusterSums[cluster].g += colors[i].g;
            clusterSums[cluster].b += colors[i].b;
        }
        for (let i = 0; i < count; i++) {
            if (clusterCounts[i] === 0) {
                continue;
            }
            means[i] = {
                r: Math.trunc(clusterSums[i].r / clusterCounts[i]),
                g: Math.trunc(clusterSums[i].g / clusterCounts[i]),
                b: Math.trunc(clusterSums[i].b / clusterCounts[i]),
            };
        }
    }
    return means;
}

export function sectorsHighMidLow(img: ImageData, count: number): RGB[] {
    const candidates: RGB[] = [];
    const colors = colorArrayFromImage(img);
    const sectors = count * 3;
    const sectorSize = Math.floor(colors.length / sectors);
    for (let i = 0; i < sectors; i++) {
        const range = colors.slice(sectorSize * i, sectorSize * i + sectorSize);
        if (range.length === 0) {
            continue;
        }
        range.sort((a, b) => getBrightness(a) - getBrightness(b));
        const third = Math.floor(range.length / 3);
        candidates.push(averageColors(range.slice(0, third)));
        candidates.push(averageColors(range.slice(third, third + third)));
        const twoThirds = Math.floor((range.length * 2) / 3);
        candidates.push(averageColors(range.slice(twoThirds, twoThirds + third)));
    }

    candidates.sort((a, b) => getBrightness(a) - getBrightness(b));
    const result: RGB[] = [];
    if (candidates.length === 0) {
        return result;
    }
    result.push(candidates[0]);
    candidates.splice(0, 1);
    while (result.length < count && candidates.length > 0) {
        let bestColorId = 0;
        let maxDistance = Number.MIN_SAFE_INTEGER;
        for (let i = 0; i < candidates.length; i++) {
            let minDistance = Number.MAX_SAFE_INTEGER;
            for (const existing of result) {
                const distance = getDistance(candidates[i], existing);
                if (distance < minDistance) {
                    minDistance = distance;
                }
            }
            if (minDistance > maxDistance) {
                bestColorId = i;
                maxDistance = minDistance;
            }
        }
        result.push(candidates[bestColorId]);
        candidates.splice(bestColorId, 1);
    }
    return result;
}

export function fakeDuoTone(count: number, hue: number, saturation: number): RGB[] {
    const result: RGB[] = [];
    for (let i = 0; i < count; i++) {
        result.push(hslToColor({ h: hue, s: saturation, l: i / count + 1 / (count * 2) }));
    }
    return result;
}
