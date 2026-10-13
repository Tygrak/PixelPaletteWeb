// Port of PixelPalette/Algorithm/Ditherer.cs

import { getDistance, getMinDistance, RGB } from '../shared/color';
import { colorArrayFromImage, createEmptyImage, intArrayFromImage, setPixel } from '../shared/image';

export function closestColor(img: ImageData, palette: RGB[]): ImageData {
    const colors = colorArrayFromImage(img);
    const result = createEmptyImage(img.width, img.height);
    for (let x = 0; x < img.width; x++) {
        for (let y = 0; y < img.height; y++) {
            setPixel(result, x, y, getMinDistance(colors[x + y * img.width], palette));
        }
    }
    return result;
}

function addToPixelInArray(
    colors: RGB[],
    x: number,
    y: number,
    width: number,
    toAdd: RGB,
    multiplier: number,
): void {
    const pos = x + y * width;
    if (x >= width || x < 0 || pos < 0 || pos >= colors.length) {
        return;
    }
    const current = colors[pos];
    colors[pos] = {
        r: Math.trunc(current.r + toAdd.r * multiplier),
        g: Math.trunc(current.g + toAdd.g * multiplier),
        b: Math.trunc(current.b + toAdd.b * multiplier),
    };
}

export function floydSteinbergDither(img: ImageData, palette: RGB[], errorMatrix: number[]): ImageData {
    if (!errorMatrix || errorMatrix.length < 4) {
        throw new Error('Error diffusion matrix needs to have 4 values');
    }
    const colors = intArrayFromImage(img);
    const width = img.width;
    const height = img.height;
    const result = createEmptyImage(width, height);
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            const pixel = colors[x + y * width];
            const nearestColor = getMinDistance(pixel, palette);
            const error = {
                r: pixel.r - nearestColor.r,
                g: pixel.g - nearestColor.g,
                b: pixel.b - nearestColor.b,
            };
            addToPixelInArray(colors, x + 1, y, width, error, errorMatrix[0]);
            addToPixelInArray(colors, x - 1, y + 1, width, error, errorMatrix[1]);
            addToPixelInArray(colors, x, y + 1, width, error, errorMatrix[2]);
            addToPixelInArray(colors, x + 1, y + 1, width, error, errorMatrix[3]);
            setPixel(result, x, y, nearestColor);
        }
    }
    return result;
}

export function minAvgErrDither(img: ImageData, palette: RGB[], errorMatrix: number[]): ImageData {
    if (!errorMatrix || errorMatrix.length < 12) {
        throw new Error('Error diffusion matrix needs to have 12 values');
    }
    const colors = intArrayFromImage(img);
    const width = img.width;
    const height = img.height;
    const result = createEmptyImage(width, height);
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            const pixel = colors[x + y * width];
            const nearestColor = getMinDistance(pixel, palette);
            const error = {
                r: pixel.r - nearestColor.r,
                g: pixel.g - nearestColor.g,
                b: pixel.b - nearestColor.b,
            };
            addToPixelInArray(colors, x + 1, y, width, error, errorMatrix[0]);
            addToPixelInArray(colors, x + 2, y, width, error, errorMatrix[1]);
            addToPixelInArray(colors, x - 2, y + 1, width, error, errorMatrix[2]);
            addToPixelInArray(colors, x - 1, y + 1, width, error, errorMatrix[3]);
            addToPixelInArray(colors, x, y + 1, width, error, errorMatrix[4]);
            addToPixelInArray(colors, x + 1, y + 1, width, error, errorMatrix[5]);
            addToPixelInArray(colors, x + 2, y + 1, width, error, errorMatrix[6]);
            addToPixelInArray(colors, x - 2, y + 2, width, error, errorMatrix[7]);
            addToPixelInArray(colors, x - 1, y + 2, width, error, errorMatrix[8]);
            addToPixelInArray(colors, x, y + 2, width, error, errorMatrix[9]);
            addToPixelInArray(colors, x + 1, y + 2, width, error, errorMatrix[10]);
            addToPixelInArray(colors, x + 2, y + 2, width, error, errorMatrix[11]);
            setPixel(result, x, y, nearestColor);
        }
    }
    return result;
}

export function orderedDither(img: ImageData, palette: RGB[], matrix: number[][]): ImageData {
    const colors = intArrayFromImage(img);
    const result = createEmptyImage(img.width, img.height);
    const width = img.width;
    const height = img.height;
    const matrixWidth = matrix.length;
    const matrixHeight = matrix[0]?.length ?? 0;
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            const pixel = colors[x + y * width];
            const m = matrix[x % matrixWidth][y % matrixHeight];
            const adjustment = (255 / 4) * (m - 1 / 2);
            pixel.r = Math.trunc(pixel.r + adjustment);
            pixel.g = Math.trunc(pixel.g + adjustment);
            pixel.b = Math.trunc(pixel.b + adjustment);
            setPixel(result, x, y, getMinDistance(pixel, palette));
        }
    }
    return result;
}

export function randomDither(img: ImageData, palette: RGB[], bias = 10): ImageData {
    const colors = colorArrayFromImage(img);
    const result = createEmptyImage(img.width, img.height);
    const width = img.width;
    const height = img.height;
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            const pixel = colors[x + y * width];
            let highestDistance = 0;
            let lowestDistance = Number.MAX_SAFE_INTEGER;
            let distanceSum = 0;
            const distances = new Array<number>(palette.length);
            for (let i = 0; i < palette.length; i++) {
                const distance = Math.trunc(getDistance(palette[i], pixel));
                distances[i] = distance;
                if (highestDistance < distance) {
                    highestDistance = distance;
                }
                if (lowestDistance > distance) {
                    lowestDistance = distance;
                }
            }
            for (let i = 0; i < palette.length; i++) {
                distances[i] = Math.pow(lowestDistance + highestDistance - distances[i], bias);
                distanceSum += distances[i];
            }
            const chosen = Math.random() * distanceSum;
            let currentRange = 0;
            for (let i = 0; i < distances.length; i++) {
                currentRange += distances[i];
                if (currentRange > chosen) {
                    setPixel(result, x, y, palette[i]);
                    break;
                }
            }
        }
    }
    return result;
}
