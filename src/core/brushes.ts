// Brush engine: a data-driven description of a brush tip plus the coverage
// math that turns it into per-pixel alpha. A brush is defined by:
//   - shape: roundness + rotation, plus optional lobes for a complex tip
//   - falloff: hardness controls how far from the rim the transparency fades
//   - antialias: false paints exact hard pixels (pencil-style, no AA)
//   - texture: a multiplier sampled in stroke space (see below)
//   - pressure: per-brush curves for how size and alpha track pen pressure
//
// Texture is sampled in *stroke space*: the coordinate advances along the
// stroke (arc length) and across it, so the grain travels with the brush instead
// of sitting still on the canvas like a document-space pattern. Brushes can opt
// into document space instead (documentTexture), which pins the pattern to the
// canvas so separate strokes line up (used by the hatching brush). Either way a
// given canvas pixel sees a stable texture value for the whole stroke, so
// textured brushes can cap their coverage at that value, and grain survives at
// full opacity instead of filling in from overlapping stamps.

// Per-brush pressure response. `min` is the factor at zero pressure and `curve`
// shapes the ramp; a `min` of 1 ignores pressure entirely.
export interface BrushPressure {
    sizeMin: number;
    sizeCurve: number;
    alphaMin: number;
    alphaCurve: number;
}

export type TextureKind = 'none' | 'noise' | 'chalk' | 'grain' | 'fibers' | 'hatch';

export interface BrushTexture {
    kind: TextureKind;
    // Feature size in pixels (larger = coarser grain).
    scale: number;
    // Coverage where the texture is darkest. 0 lets gaps go fully clear, higher
    // values keep a floor of transparency in them.
    min: number;
    // Coverage where the texture is lightest. 1 lets the texture reach full
    // opacity; lower values keep even the highlights transparent.
    max: number;
    // Line orientation for directional textures (radians), relative to the stroke.
    angle: number;
    // Pushes texture values toward 0/1 so marks stay opaque and the texture
    // breaks them up with gaps instead of washing everything to partial alpha.
    contrast: number;
}

export interface Brush {
    id: string;
    label: string;
    // 1 = perfectly circular tip; lower values flatten the tip into an ellipse.
    roundness: number;
    // Tip rotation in radians (only visible when roundness < 1 or lobes are on).
    angle: number;
    // 1 = crisp edge, 0 = transparency fades from the very center.
    hardness: number;
    // false paints exact pixels with no antialiasing (pencil-style).
    antialias: boolean;
    // Strict pixel mode: each touched pixel is painted at full opacity (ignore
    // brush opacity/pressure), giving clean 100%-or-0% pixel-art marks.
    pixel: boolean;
    pressure: BrushPressure;
    // Stamp spacing as a fraction of the radius; smaller = smoother strokes.
    spacing: number;
    texture: BrushTexture;
    // Number of scalloped lobes around the rim (1 = plain round/ellipse).
    lobes: number;
    // Depth of the lobes (0..1); 0 disables them.
    lobeDepth: number;
    // Random per-stamp tip rotation (radians) applied while drawing.
    rotationJitter: number;
    // 1 = texture only around the rim while the core stays solid (charcoal-like
    // edges); 0 = texture across the whole tip.
    edgeTexture: number;
    // true = the texture is pinned to the document (a fixed pattern on the
    // canvas) instead of travelling with the stroke. Repeated strokes line up
    // exactly, which is what hatching needs.
    documentTexture: boolean;
}

// The stroke-space frame a stamp samples its texture in.
export interface TextureFrame {
    dirX: number;
    dirY: number;
    distance: number;
    seedX: number;
    seedY: number;
}

function tex(kind: TextureKind, scale: number, min: number, max: number, contrast = 0, angle = 0): BrushTexture {
    return { kind, scale, min, max, angle, contrast };
}
const NONE = tex('none', 1, 0, 1);

export const DEFAULT_BRUSH_ID = 'default';

// Built-in default brushes. User edits and custom brushes are layered on top
// of these in brushLibrary.ts, which is what the app reads at runtime.
export const BRUSHES: Brush[] = [
    {
        id: 'default',
        label: 'Round',
        roundness: 1,
        angle: 0,
        hardness: 1,
        antialias: true,
        pixel: false,
        // Pressure thins the tip only; opacity stays full so taps and light
        // presses still make solid marks.
        pressure: { sizeMin: 0.35, sizeCurve: 1, alphaMin: 1, alphaCurve: 1 },
        spacing: 0.12,
        texture: NONE,
        lobes: 1,
        lobeDepth: 0,
        rotationJitter: 0,
        edgeTexture: 0,
        documentTexture: false,
    },
    {
        id: 'soft',
        label: 'Soft Round',
        roundness: 1,
        angle: 0,
        hardness: 0,
        antialias: true,
        pixel: false,
        pressure: { sizeMin: 0.35, sizeCurve: 1, alphaMin: 0.25, alphaCurve: 1 },
        spacing: 0.1,
        texture: NONE,
        lobes: 1,
        lobeDepth: 0,
        rotationJitter: 0,
        edgeTexture: 0,
        documentTexture: false,
    },
    {
        id: 'pixel',
        label: 'Pixel Pencil',
        roundness: 1,
        angle: 0,
        hardness: 1,
        // No antialiasing and no opacity blending: exact on/off pixels.
        antialias: false,
        pixel: true,
        pressure: { sizeMin: 1, sizeCurve: 1, alphaMin: 1, alphaCurve: 1 },
        spacing: 0.05,
        texture: NONE,
        lobes: 1,
        lobeDepth: 0,
        rotationJitter: 0,
        edgeTexture: 0,
        documentTexture: false,
    },
    {
        id: 'charcoal',
        label: 'Charcoal Pencil',
        // Basically a round brush, but the rim is broken up by a light texture
        // while the core stays solid (even at full pressure and opacity).
        roundness: 1,
        angle: 0,
        hardness: 0.55,
        antialias: true,
        pixel: false,
        // Pressure thins the tip only; opacity stays full so strokes build up
        // from overlap rather than from pressure.
        pressure: { sizeMin: 0.35, sizeCurve: 1, alphaMin: 1, alphaCurve: 1 },
        spacing: 0.08,
        // Grain that builds smoothly from a near-solid core out to a crumbly rim.
        texture: tex('chalk', 3, 0.4, 1, 0.5),
        lobes: 1,
        lobeDepth: 0,
        rotationJitter: 0,
        edgeTexture: 1,
        documentTexture: false,
    },
    {
        id: 'charcoal-pressure',
        label: 'Charcoal Pencil (Pressure)',
        // Same tip as charcoal, but pressure also fades opacity.
        roundness: 1,
        angle: 0,
        hardness: 0.55,
        antialias: true,
        pixel: false,
        pressure: { sizeMin: 0.35, sizeCurve: 1, alphaMin: 0.25, alphaCurve: 1 },
        spacing: 0.08,
        texture: tex('chalk', 3, 0.6, 0.5),
        lobes: 1,
        lobeDepth: 0,
        rotationJitter: 0,
        edgeTexture: 1,
        documentTexture: false,
    },
    {
        id: 'gpen',
        label: 'Ink G-Pen',
        roundness: 0.3,
        angle: -0.5,
        hardness: 0.95,
        antialias: true,
        pixel: false,
        // Calligraphic: pressure drives width hard while the ink stays opaque.
        pressure: { sizeMin: 0.12, sizeCurve: 0.75, alphaMin: 0.85, alphaCurve: 1 },
        spacing: 0.035,
        texture: NONE,
        lobes: 1,
        lobeDepth: 0,
        rotationJitter: 0,
        edgeTexture: 0,
        documentTexture: false,
    },
    {
        id: 'chalk',
        label: 'Chalk Grainy',
        roundness: 1,
        angle: 0,
        hardness: 0.35,
        antialias: true,
        pixel: false,
        pressure: { sizeMin: 0.5, sizeCurve: 1, alphaMin: 0.18, alphaCurve: 1.2 },
        spacing: 0.07,
        texture: tex('grain', 2.4, 0.15, 1, 0.7),
        lobes: 1,
        lobeDepth: 0,
        rotationJitter: 0,
        edgeTexture: 0,
        documentTexture: false,
    },
    {
        id: 'texturing',
        label: 'Texturing Noisy',
        // A scalloped, randomly re-rotated tip dragged around to build up texture.
        roundness: 0.75,
        angle: 0.3,
        hardness: 0.8,
        antialias: true,
        pixel: false,
        pressure: { sizeMin: 0.4, sizeCurve: 1, alphaMin: 0.3, alphaCurve: 1 },
        spacing: 0.14,
        texture: tex('grain', 3.4, 0.1, 1, 0.72),
        lobes: 5,
        lobeDepth: 0.55,
        rotationJitter: 2.4,
        edgeTexture: 0,
        documentTexture: false,
    },
    {
        id: 'hatching',
        label: 'Hatching',
        // A round tip whose hatch lines are pinned to the document, so successive
        // strokes line up into regular diagonal shading. The per-stroke coverage
        // cap keeps a stroke from stacking past the set opacity no matter how much
        // it overlaps itself.
        roundness: 1,
        angle: 0,
        hardness: 1,
        antialias: true,
        pixel: true,
        pressure: { sizeMin: 0.5, sizeCurve: 1, alphaMin: 0.5, alphaCurve: 1 },
        spacing: 0.05,
        // 45-degree lines in document space, one every `scale` pixels.
        texture: tex('hatch', 5, 0, 1, 0.75, Math.PI / 4),
        lobes: 1,
        lobeDepth: 0,
        rotationJitter: 0,
        edgeTexture: 0,
        documentTexture: true,
    },
];

// Applies a brush's pressure curve; `pressure` is 0..1.
export function pressureFactor(min: number, curve: number, pressure: number): number {
    const p = pressure <= 0 ? 0 : pressure >= 1 ? 1 : pressure;
    return min + (1 - min) * Math.pow(p, curve);
}

function clamp01(value: number): number {
    if (value < 0) {
        return 0;
    }
    return value > 1 ? 1 : value;
}

// --- Procedural texture sampling ---

function hash2(x: number, y: number): number {
    let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967295;
}

// Smooth value noise in [0, 1]; bilinear blend of hashed lattice values.
function valueNoise(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const n00 = hash2(x0, y0);
    const n10 = hash2(x0 + 1, y0);
    const n01 = hash2(x0, y0 + 1);
    const n11 = hash2(x0 + 1, y0 + 1);
    const nx0 = n00 + (n10 - n00) * sx;
    const nx1 = n01 + (n11 - n01) * sx;
    return nx0 + (nx1 - nx0) * sy;
}

// Layered noise for a richer, more natural grain.
function fbm(x: number, y: number): number {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let norm = 0;
    for (let octave = 0; octave < 3; octave++) {
        value += amplitude * valueNoise(x * frequency, y * frequency);
        norm += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }
    return value / norm;
}

function rawTexture(texture: BrushTexture, x: number, y: number): number {
    const scale = Math.max(0.5, texture.scale);
    const ca = Math.cos(texture.angle);
    const sa = Math.sin(texture.angle);
    const u = x / scale;
    const v = y / scale;
    switch (texture.kind) {
        case 'noise':
            return valueNoise(u, v);
        case 'grain':
            return fbm(u, v);
        case 'chalk': {
            const n = fbm(u, v);
            // Push toward black/white so the medium breaks up into clumps.
            return clamp01((n - 0.3) / 0.45);
        }
        case 'fibers': {
            // Noise stretched along the grain direction for streaky fibers.
            const along = (x * ca + y * sa) / scale;
            const across = (-x * sa + y * ca) / (scale * 3);
            return fbm(along, across);
        }
        case 'hatch': {
            const along = x * ca + y * sa;
            const line = 0.5 + 0.5 * Math.sin((along / scale) * Math.PI * 2);
            return clamp01(line * 0.85 + fbm(u, v) * 0.15);
        }
        default:
            return 1;
    }
}

// Remaps a texture value toward 0/1 as contrast rises, so textured marks stay
// solid and the texture reads as gaps rather than a uniform gray wash.
function applyContrast(value: number, contrast: number): number {
    if (contrast <= 0) {
        return value;
    }
    const half = 0.5 * (1 - contrast) + 0.02;
    const t = clamp01((value - (0.5 - half)) / (2 * half));
    return t * t * (3 - 2 * t);
}

// Texture coverage in [min, max]; multiplies whatever coverage the brush shape
// produced so soft edges and textures compose naturally. `min` is the coverage
// where the texture is darkest and `max` where it is lightest, so a texture can
// both break marks up with gaps and stay short of full opacity.
export function textureValue(texture: BrushTexture, x: number, y: number): number {
    if (texture.kind === 'none') {
        return 1;
    }
    const value = applyContrast(rawTexture(texture, x, y), texture.contrast);
    const min = clamp01(texture.min);
    const max = clamp01(texture.max);
    return min + (max - min) * value;
}

// True when a texture actually modulates coverage. Strokes using one need the
// per-stroke coverage cap so overlapping stamps do not fill the grain in.
export function textureModulates(texture: BrushTexture): boolean {
    return texture.kind !== 'none' && (clamp01(texture.min) < 1 || clamp01(texture.max) < 1);
}

// --- Brush tip coverage ---

// Normalized distance from the stamp center: 0 at the center, 1 at the rim
// (before falloff). Accounts for an elliptical / lobed tip and its rotation.
function normalizedDistance(dx: number, dy: number, radius: number, brush: Brush, angle: number): number {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rx = dx * cos + dy * sin;
    const ry = -dx * sin + dy * cos;
    const minor = Math.max(0.05, brush.roundness);
    let nd = Math.hypot(rx / radius, ry / (radius * minor));
    if (brush.lobes > 1 && brush.lobeDepth > 0) {
        // Scallop the rim: notches where cos is high, points where it is low.
        const theta = Math.atan2(ry, rx);
        const lobe = 1 - brush.lobeDepth * (0.5 + 0.5 * Math.cos(brush.lobes * theta));
        nd /= Math.max(0.05, lobe);
    }
    return nd;
}

// Turns a normalized distance into coverage using the brush's hardness.
function falloff(nd: number, radius: number, brush: Brush): number {
    if (!brush.antialias) {
        return nd <= 1 ? 1 : 0;
    }
    const feather = 1 - brush.hardness;
    if (feather <= 1e-4) {
        // Crisp edge, antialiased across roughly one pixel.
        const pixelDistance = (1 - nd) * radius;
        return clamp01(pixelDistance + 0.5);
    }
    if (nd >= 1) {
        return 0;
    }
    if (nd <= brush.hardness) {
        return 1;
    }
    const t = (1 - nd) / feather;
    return t * t * (3 - 2 * t);
}

// Coverage of a single pixel offset from the stamp center, before texture.
// `angle` overrides the tip rotation for this stamp (random jitter).
export function brushShape(dx: number, dy: number, radius: number, brush: Brush, angle = brush.angle): number {
    if (radius <= 0) {
        return 0;
    }
    return falloff(normalizedDistance(dx, dy, radius, brush, angle), radius, brush);
}

// Full coverage at a document pixel: brush shape multiplied by its texture.
// Texture is sampled in stroke space when `frame` is given, otherwise in the
// tip's own (rotated) coordinates.
export function brushCoverage(
    brush: Brush,
    docX: number,
    docY: number,
    centerX: number,
    centerY: number,
    radius: number,
    angle = brush.angle,
    frame: TextureFrame | null = null,
    applyTexture = true,
): number {
    // Hard (non-antialiased) tips snap to the pixel grid so their painted pixels
    // exactly match the on-screen footprint preview.
    const cx = brush.antialias ? centerX : Math.floor(centerX);
    const cy = brush.antialias ? centerY : Math.floor(centerY);
    const dx = docX - cx;
    const dy = docY - cy;
    if (radius <= 0) {
        return 0;
    }
    let texX: number;
    let texY: number;
    if (brush.documentTexture) {
        // Document-space texture: pinned to the canvas, so overlapping strokes
        // repeat the same pattern instead of each carrying its own.
        texX = docX;
        texY = docY;
    } else if (frame) {
        texX = frame.distance + dx * frame.dirX + dy * frame.dirY + frame.seedX;
        texY = -dx * frame.dirY + dy * frame.dirX + frame.seedY;
    } else {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        texX = dx * cos + dy * sin;
        texY = -dx * sin + dy * cos;
    }
    const hasTexture = applyTexture && textureModulates(brush.texture);

    if (hasTexture && brush.edgeTexture > 0) {
        // Texture runs through the whole tip but its influence ramps smoothly with
        // radius (quadratic), so the core reads as solid while the grain builds
        // toward the rim. Because the same material covers the entire stroke there
        // is no seam between a "solid" and a "textured" brush.
        const nd = normalizedDistance(dx, dy, radius, brush, angle);
        const shape = falloff(nd, radius, brush);
        if (shape <= 0) {
            return 0;
        }
        const t = textureValue(brush.texture, texX, texY);
        // Smoothstep ramp over the whole radius: grain is ~0 at the very center
        // and fades in gently, so there is no ring where texturing begins.
        const r = Math.min(1, nd);
        const influence = brush.edgeTexture * r * r * (3 - 2 * r);
        return shape * (1 - influence * (1 - t));
    }

    const shape = brushShape(dx, dy, radius, brush, angle);
    if (shape <= 0 || !hasTexture) {
        return shape;
    }
    return shape * textureValue(brush.texture, texX, texY);
}

// The integer pixel offsets a non-antialiased brush paints, relative to the
// cursor pixel. Used to preview pencil-style tips exactly.
export function brushFootprint(size: number, brush: Brush): { dx: number; dy: number }[] {
    const radius = Math.max(0.5, size / 2);
    const half = Math.ceil(radius) + 1;
    const offsets: { dx: number; dy: number }[] = [];
    for (let dy = -half; dy <= half; dy++) {
        for (let dx = -half; dx <= half; dx++) {
            if (brushShape(dx, dy, radius, brush) > 0) {
                offsets.push({ dx, dy });
            }
        }
    }
    return offsets;
}
