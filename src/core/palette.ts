// Port of PixelPalette/Algorithm/PaletteGeneration.cs

import {
    averageColors,
    getBrightness,
    getDistance,
    getHue,
    getMinDistanceIndex,
    getSaturation,
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

// Splits colors into the near-extreme set and the hue clusters of everything
// else. Colors within a margin of the darkest or brightest lightness are kept
// out of the clusters entirely (they cannot become cluster representatives).
// The remaining colors are laid out on a continuous hue line (rotated to start
// after the largest hue gap, so reds are not split across the 0/360 boundary)
// and the occupied hue range is split into equal parts, so cluster width is
// driven by hue span instead of pixel count: a dominant hue cannot crowd out
// rarer ones, and parts with no colors are skipped.
interface HueClusterSplit {
    extremes: RGB[];
    groups: RGB[][];
}

function splitHueClusters(colors: RGB[], count: number): HueClusterSplit {
    if (colors.length === 0) {
        return { extremes: [], groups: [] };
    }
    let minLightness = Number.MAX_VALUE;
    let maxLightness = -Number.MAX_VALUE;
    for (const color of colors) {
        const lightness = getBrightness(color);
        if (lightness < minLightness) {
            minLightness = lightness;
        }
        if (lightness > maxLightness) {
            maxLightness = lightness;
        }
    }
    const margin = Math.max(0.05, (maxLightness - minLightness) * 0.15);
    const extremes: RGB[] = [];
    const rest: RGB[] = [];
    for (const color of colors) {
        const lightness = getBrightness(color);
        if (lightness - minLightness < margin || maxLightness - lightness < margin) {
            extremes.push(color);
        } else {
            rest.push(color);
        }
    }

    const groups: RGB[][] = [];
    if (rest.length > 0) {
        const sorted = rest.sort((a, b) => getHue(a) - getHue(b));
        let start = 0;
        let largestGap = -1;
        for (let i = 0; i < sorted.length; i++) {
            const hue = getHue(sorted[i]);
            const nextHue = i + 1 < sorted.length ? getHue(sorted[i + 1]) : getHue(sorted[0]) + 360;
            const gap = nextHue - hue;
            if (gap > largestGap) {
                largestGap = gap;
                start = (i + 1) % sorted.length;
            }
        }
        // Hues past the rotation start get +360 so positions rise along the
        // rotated sequence and a single span covers the occupied range.
        const rotated: RGB[] = [];
        const positions: number[] = [];
        for (let i = 0; i < sorted.length; i++) {
            const index = (start + i) % sorted.length;
            const hue = getHue(sorted[index]);
            positions.push(index < start ? hue + 360 : hue);
            rotated.push(sorted[index]);
        }
        const minPosition = positions[0];
        const span = positions[positions.length - 1] - minPosition;
        const clusterCount = Math.max(1, Math.min(Math.round(count), rotated.length));
        const width = span / clusterCount;
        const slots: RGB[][] = Array.from({ length: clusterCount }, () => []);
        for (let i = 0; i < rotated.length; i++) {
            const slot =
                width <= 0 ? 0 : Math.min(clusterCount - 1, Math.floor((positions[i] - minPosition) / width));
            slots[slot].push(rotated[i]);
        }
        for (const slot of slots) {
            if (slot.length > 0) {
                groups.push(slot);
            }
        }
    }
    return { extremes, groups };
}

// Colors closer than this (RGB distance) count as near duplicates.
const NEAR_DUPLICATE_DISTANCE = 32;

function minDistanceTo(color: RGB, colors: RGB[]): number {
    let min = Number.MAX_VALUE;
    for (const other of colors) {
        const distance = getDistance(color, other);
        if (distance < min) {
            min = distance;
        }
    }
    return min;
}

// Picks `count` colors from a cluster, spread as far apart as possible: the
// most saturated color comes first, then each next pick is the color with the
// largest minimum RGB distance to everything picked so far (farthest-point
// sampling). `taken` (the extremes and colors from earlier clusters) counts as
// well, so picks stay clear of the rest of the palette, and colors closer than
// `minDistance` to anything already picked are rejected as near duplicates.
function pickSpread(colors: RGB[], count: number, taken: RGB[], minDistance: number): RGB[] {
    const picks: RGB[] = [];
    if (colors.length === 0 || count <= 0) {
        return picks;
    }
    let seed: RGB | null = null;
    let bestSaturation = -1;
    for (const color of colors) {
        if (minDistanceTo(color, taken) < minDistance) {
            continue;
        }
        const saturation = getSaturation(color);
        if (saturation > bestSaturation) {
            bestSaturation = saturation;
            seed = color;
        }
    }
    if (!seed) {
        return picks;
    }
    picks.push(seed);
    while (picks.length < count) {
        let best: RGB | null = null;
        let bestDistance = minDistance;
        for (const color of colors) {
            const distance = Math.min(minDistanceTo(color, taken), minDistanceTo(color, picks));
            if (distance > bestDistance) {
                bestDistance = distance;
                best = color;
            }
        }
        if (!best) {
            break;
        }
        picks.push(best);
    }
    return picks;
}

// Drops colors within `minDistance` of an earlier color, so the palette never
// contains near duplicates (exact duplicates included).
function pruneNearDuplicates(colors: RGB[]): RGB[] {
    const kept: RGB[] = [];
    for (const color of colors) {
        if (minDistanceTo(color, kept) >= NEAR_DUPLICATE_DISTANCE) {
            kept.push(color);
        }
    }
    return kept;
}

// Palette built from lightness extremes plus hue clusters: the darkest and
// brightest image colors are always included, then each hue cluster (of the
// colors that are not near an extreme) contributes `perCluster` colors spread
// as far apart as possible, without near duplicates.
export function hueClusters(img: ImageData, count: number, perCluster: number): RGB[] {
    const colors = colorArrayFromImage(img);
    if (colors.length === 0) {
        return [];
    }
    const { groups } = splitHueClusters(colors, count);

    let darkest = colors[0];
    let brightest = colors[0];
    let minLightness = getBrightness(darkest);
    let maxLightness = minLightness;
    for (const color of colors) {
        const lightness = getBrightness(color);
        if (lightness < minLightness) {
            minLightness = lightness;
            darkest = color;
        }
        if (lightness > maxLightness) {
            maxLightness = lightness;
            brightest = color;
        }
    }

    const picks = Math.max(1, Math.round(perCluster));
    const result: RGB[] = [darkest, brightest];
    for (const group of groups) {
        result.push(...pickSpread(group, picks, result, NEAR_DUPLICATE_DISTANCE));
    }

    return pruneNearDuplicates(result).sort((a, b) => getBrightness(a) - getBrightness(b));
}

// Preview for the hue cluster palette: one horizontal band per segment (the
// colors removed from clustering come first, then each hue cluster), each
// sorted by lightness so the band reads as a smooth ramp, with a dashed
// black/white separator line on top of every band so cluster boundaries stay
// visible over any color.
export function sortHueClusters(img: ImageData, count: number): ImageData {
    const colors = colorArrayFromImage(img);
    const { extremes, groups } = splitHueClusters(colors, count);

    const segments: RGB[][] = [];
    if (extremes.length > 0) {
        segments.push(extremes.sort((a, b) => getBrightness(a) - getBrightness(b)));
    }
    for (const group of groups) {
        segments.push(group.sort((a, b) => getBrightness(a) - getBrightness(b)));
    }

    const width = img.width;
    const height = img.height;
    const result = createEmptyImage(width, height);
    if (segments.length === 0) {
        return result;
    }

    const band = Math.floor(height / segments.length);
    if (band < 2) {
        // Too little room for separate bands: just lay the colors out in order.
        let index = 0;
        for (const segment of segments) {
            for (const color of segment) {
                if (index >= width * height) {
                    break;
                }
                setPixel(result, index % width, Math.floor(index / width), color);
                index++;
            }
        }
        return result;
    }

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const top = i * band;
        const bottom = i === segments.length - 1 ? height : top + band;
        if (top >= height || segment.length === 0) {
            continue;
        }
        // Dashed separator on the band's first row: visible against both dark
        // and light colors, unlike a plain black line.
        for (let x = 0; x < width; x++) {
            setPixel(result, x, top, x % 2 === 0 ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 });
        }
        // The cluster's colors fill the rest of the band as a lightness ramp,
        // sampled evenly when the band has fewer slots than colors.
        const slots = (bottom - top - 1) * width;
        for (let slot = 0; slot < slots; slot++) {
            const colorIndex = Math.min(segment.length - 1, Math.floor((slot * segment.length) / slots));
            setPixel(result, slot % width, top + 1 + Math.floor(slot / width), segment[colorIndex]);
        }
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
