// Port of PixelPalette/Algorithm/ColorAdjustments.cs

import { clampRgbToColor, colorToHsl, hslToColor, RGB } from './color';
import { colorArrayFromImage, createEmptyImage, setPixel } from './image';

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

export function blurImage(img: ImageData, sigma: number): ImageData {
  const range = Math.trunc(1 + sigma * 2);
  const c = 1 / Math.sqrt(sigma * sigma * 2 * Math.PI);
  const blurMatrix = new Array<number>(range);
  for (let i = 0; i < range; i++) {
    blurMatrix[i] = Math.pow(Math.E, -(i * i) / (2 * sigma * sigma)) * c;
  }

  const colors = colorArrayFromImage(img);
  const colors2 = new Array<RGB>(colors.length);
  const result = createEmptyImage(img.width, img.height);
  const width = img.width;
  const height = img.height;

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let i = x - range + 1; i < x + range; i++) {
        const kernelIndex = Math.abs(x - i);
        if (i < 0 || i >= width) {
          r += colors[x + y * width].r * blurMatrix[kernelIndex];
          g += colors[x + y * width].g * blurMatrix[kernelIndex];
          b += colors[x + y * width].b * blurMatrix[kernelIndex];
        } else {
          r += colors[i + y * width].r * blurMatrix[kernelIndex];
          g += colors[i + y * width].g * blurMatrix[kernelIndex];
          b += colors[i + y * width].b * blurMatrix[kernelIndex];
        }
      }
      colors2[x + y * width] = clampRgbToColor(r, g, b);
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let j = y - range + 1; j < y + range; j++) {
        const kernelIndex = Math.abs(y - j);
        if (j < 0 || j >= height) {
          r += colors[x + y * width].r * blurMatrix[kernelIndex];
          g += colors[x + y * width].g * blurMatrix[kernelIndex];
          b += colors[x + y * width].b * blurMatrix[kernelIndex];
        } else {
          r += colors2[x + j * width].r * blurMatrix[kernelIndex];
          g += colors2[x + j * width].g * blurMatrix[kernelIndex];
          b += colors2[x + j * width].b * blurMatrix[kernelIndex];
        }
      }
      setPixel(result, x, y, clampRgbToColor(r, g, b));
    }
  }
  return result;
}
