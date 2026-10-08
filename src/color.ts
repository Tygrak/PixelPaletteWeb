// Port of PixelPalette/Algorithm/ColorHelpers.cs and ColorConvertors.cs
// using System.Drawing.Color semantics (GetHue/GetSaturation/GetBrightness).

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface HSL {
  h: number;
  s: number;
  l: number;
}

export function rgb(r: number, g: number, b: number): RGB {
  return { r, g, b };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// Returns a color clamped to the 0-255 range (System.Drawing.Color.FromArgb style).
// Values are truncated to int before clamping, mirroring ClampRgbToColor.
export function clampRgbToColor(r: number, g: number, b: number): RGB {
  return {
    r: clamp(Math.trunc(r), 0, 255),
    g: clamp(Math.trunc(g), 0, 255),
    b: clamp(Math.trunc(b), 0, 255),
  };
}

// --- System.Drawing.Color.GetBrightness / GetSaturation / GetHue ---

export function getBrightness(c: RGB): number {
  const max = Math.max(c.r, Math.max(c.g, c.b));
  const min = Math.min(c.r, Math.min(c.g, c.b));
  return (max + min) / 510;
}

export function getSaturation(c: RGB): number {
  const max = Math.max(c.r, Math.max(c.g, c.b));
  const min = Math.min(c.r, Math.min(c.g, c.b));
  if (max === min) {
    return 0;
  }
  let denom = max + min;
  if (denom > 255) {
    denom = 510 - denom;
  }
  return (max - min) / denom;
}

export function getHue(c: RGB): number {
  const max = Math.max(c.r, Math.max(c.g, c.b));
  const min = Math.min(c.r, Math.min(c.g, c.b));
  if (max === min) {
    return 0;
  }
  const delta = max - min;
  let hue: number;
  if (c.r === max) {
    hue = (c.g - c.b) / delta;
  } else if (c.g === max) {
    hue = 2 + (c.b - c.r) / delta;
  } else {
    hue = 4 + (c.r - c.g) / delta;
  }
  hue *= 60;
  if (hue < 0) {
    hue += 360;
  }
  return hue;
}

export function colorToHsl(c: RGB): HSL {
  return { h: getHue(c), s: getSaturation(c), l: getBrightness(c) };
}

// Port of ColorConvertors.HslToColor ((int) truncation, hue not modded).
export function hslToColor(hsl: HSL): RGB {
  const { h: hue, s: saturation, l: lightness } = hsl;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const h = hue / 60;
  const x = chroma * (1 - Math.abs((h % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  const sector = Math.trunc(h);
  if (sector === 0) {
    r = chroma;
    g = x;
  } else if (sector === 1) {
    r = x;
    g = chroma;
  } else if (sector === 2) {
    g = chroma;
    b = x;
  } else if (sector === 3) {
    g = x;
    b = chroma;
  } else if (sector === 4) {
    r = x;
    b = chroma;
  } else if (sector === 5) {
    r = chroma;
    b = x;
  }
  const m = lightness - chroma / 2;
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function colorToHex(c: RGB): string {
  const toHex = (v: number) => clamp(Math.round(v), 0, 255).toString(16).toUpperCase().padStart(2, '0');
  return `#${toHex(c.r)}${toHex(c.g)}${toHex(c.b)}`;
}

export function hexToColor(hex: string): RGB {
  const clean = hex.trim().replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16) || 0,
    g: parseInt(clean.slice(2, 4), 16) || 0,
    b: parseInt(clean.slice(4, 6), 16) || 0,
  };
}

// --- Distances ---

export function getDistance(a: RGB, b: RGB): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

export function getMinDistanceIndex(color: RGB, palette: RGB[]): number {
  let minDistance = Number.MAX_SAFE_INTEGER;
  let minDistanceId = -1;
  for (let i = 0; i < palette.length; i++) {
    const distance = Math.trunc(getDistance(palette[i], color));
    if (distance < minDistance) {
      minDistance = distance;
      minDistanceId = i;
    }
  }
  return minDistanceId;
}

export function getMinDistance(color: RGB, palette: RGB[]): RGB {
  return palette[getMinDistanceIndex(color, palette)];
}

export function averageColors(colors: RGB[]): RGB {
  if (colors.length === 0) {
    return { r: 0, g: 0, b: 0 };
  }
  let r = 0;
  let g = 0;
  let b = 0;
  for (const color of colors) {
    r += color.r;
    g += color.g;
    b += color.b;
  }
  const n = colors.length;
  return { r: Math.trunc(r / n), g: Math.trunc(g / n), b: Math.trunc(b / n) };
}

export function distinctColors(colors: RGB[]): RGB[] {
  const seen = new Set<string>();
  const result: RGB[] = [];
  for (const c of colors) {
    const key = colorToHex(c);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(c);
    }
  }
  return result;
}

// --- RGB <-> XYZ <-> Lab (ported for completeness, mirrors ColorConvertors.cs) ---

export const XYZ_D65 = { x: 0.9505, y: 1.0, z: 1.089 };

export function rgbToXyz(r: number, g: number, b: number): { x: number; y: number; z: number } {
  const rLinear = r / 255;
  const gLinear = g / 255;
  const bLinear = b / 255;
  const sR = rLinear > 0.04045 ? ((rLinear + 0.055) / (1 + 0.055)) ** 2.2 : rLinear / 12.92;
  const sG = gLinear > 0.04045 ? ((gLinear + 0.055) / (1 + 0.055)) ** 2.2 : gLinear / 12.92;
  const sB = bLinear > 0.04045 ? ((bLinear + 0.055) / (1 + 0.055)) ** 2.2 : bLinear / 12.92;
  return {
    x: sR * 0.4124 + sG * 0.3576 + sB * 0.1805,
    y: sR * 0.2126 + sG * 0.7152 + sB * 0.0722,
    z: sR * 0.0193 + sG * 0.1192 + sB * 0.9505,
  };
}

function fXyz(t: number): number {
  return t > 0.008856 ? t ** (1 / 3) : 7.787 * t + 16 / 116;
}

export function xyzToLab(x: number, y: number, z: number): { l: number; a: number; b: number } {
  const l = 116 * fXyz(y / XYZ_D65.y) - 16;
  const a = 500 * (fXyz(x / XYZ_D65.x) - fXyz(y / XYZ_D65.y));
  const b = 200 * (fXyz(y / XYZ_D65.y) - fXyz(z / XYZ_D65.z));
  return { l, a, b };
}

export function rgbToLab(r: number, g: number, b: number): { l: number; a: number; b: number } {
  const xyz = rgbToXyz(r, g, b);
  return xyzToLab(xyz.x, xyz.y, xyz.z);
}

export function labToXyz(l: number, a: number, b: number): { x: number; y: number; z: number } {
  const delta = 6 / 29;
  const fy = (l + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  return {
    x: fx > delta ? XYZ_D65.x * fx ** 3 : (fx - 16 / 116) * 3 * delta * delta * XYZ_D65.x,
    y: fy > delta ? XYZ_D65.y * fy ** 3 : (fy - 16 / 116) * 3 * delta * delta * XYZ_D65.y,
    z: fz > delta ? XYZ_D65.z * fz ** 3 : (fz - 16 / 116) * 3 * delta * delta * XYZ_D65.z,
  };
}

export function xyzToRgb(x: number, y: number, z: number): RGB {
  const cLinear = [
    x * 3.241 - y * 1.5374 - z * 0.4986,
    -x * 0.9692 + y * 1.876 - z * 0.0416,
    x * 0.0556 - y * 0.204 + z * 1.057,
  ];
  for (let i = 0; i < 3; i++) {
    cLinear[i] = cLinear[i] <= 0.0031308 ? 12.92 * cLinear[i] : (1 + 0.055) * cLinear[i] ** (1 / 2.4) - 0.055;
  }
  return clampRgbToColor(
    Math.round(cLinear[0] * 255),
    Math.round(cLinear[1] * 255),
    Math.round(cLinear[2] * 255),
  );
}

export function labToRgb(l: number, a: number, b: number): RGB {
  const xyz = labToXyz(l, a, b);
  return xyzToRgb(xyz.x, xyz.y, xyz.z);
}
