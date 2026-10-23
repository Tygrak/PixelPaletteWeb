// Locally-persisted user settings (localStorage).

// What is shown behind the image (visible through transparent pixels).
export type CanvasBackdrop = 'checker' | 'black' | 'white';

// What the Save dialog exports.
export type SaveFormat = 'project' | 'storage' | 'current' | 'grid' | 'separate' | 'gif';

export interface Settings {
    canvasWidth: number;
    canvasHeight: number;
    backgroundColor: string; // hex
    blankNewImage: boolean; // new image starts fully transparent instead of the background color
    animationMode: boolean;
    onionSkin: boolean;
    onionOpacity: number; // 0..1
    canvasBackdrop: CanvasBackdrop;
    minimap: boolean; // overview in the bottom-right corner for panning while zoomed in
    paletteSize: number; // colors generated from an imported image
    saveFormat: SaveFormat;
    saveColumns: number; // 0 = auto
    autoSaveRecent: boolean; // keep recent documents in localStorage (crash recovery)
    autoSaveCount: number; // how many recent documents to keep
    shareEraserSize: boolean; // eraser uses the brush size instead of its own size
}

const STORAGE_KEY = 'pixelpalette.settings';

export const DEFAULT_SETTINGS: Settings = {
    canvasWidth: 1024,
    canvasHeight: 1024,
    backgroundColor: '#FFFFFF',
    blankNewImage: false,
    animationMode: false,
    onionSkin: false,
    onionOpacity: 0.4,
    canvasBackdrop: 'checker',
    minimap: false,
    paletteSize: 8,
    saveFormat: 'current',
    saveColumns: 0,
    autoSaveRecent: true,
    autoSaveCount: 20,
    shareEraserSize: false,
};

// Bounds for settings.autoSaveCount.
export const AUTO_SAVE_MIN = 1;
export const AUTO_SAVE_MAX = 50;

// Stored settings are a runtime boundary: the JSON may be old, hand-edited or
// corrupted, so every field is parsed and range-checked instead of trusted.
// Unknown fields are dropped. Invalid fields fall back to their default.

function numberSetting(value: unknown, fallback: number, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, value));
}

function integerSetting(
    value: unknown,
    fallback: number,
    min: number,
    max = Number.MAX_SAFE_INTEGER,
): number {
    return Math.round(numberSetting(value, fallback, min, max));
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function enumSetting<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const CANVAS_BACKDROPS: readonly CanvasBackdrop[] = ['checker', 'black', 'white'];
const SAVE_FORMATS: readonly SaveFormat[] = ['project', 'storage', 'current', 'grid', 'separate', 'gif'];

export function loadSettings(): Settings {
    let parsed: unknown;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return { ...DEFAULT_SETTINGS };
        }
        parsed = JSON.parse(raw);
    } catch {
        // localStorage unavailable or corrupt; fall back to defaults.
        return { ...DEFAULT_SETTINGS };
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ...DEFAULT_SETTINGS };
    }
    const data = parsed as Record<string, unknown>;
    return {
        canvasWidth: integerSetting(data.canvasWidth, DEFAULT_SETTINGS.canvasWidth, 1),
        canvasHeight: integerSetting(data.canvasHeight, DEFAULT_SETTINGS.canvasHeight, 1),
        backgroundColor:
            typeof data.backgroundColor === 'string' && /^#[0-9a-f]{6}$/i.test(data.backgroundColor)
                ? data.backgroundColor
                : DEFAULT_SETTINGS.backgroundColor,
        blankNewImage: booleanSetting(data.blankNewImage, DEFAULT_SETTINGS.blankNewImage),
        animationMode: booleanSetting(data.animationMode, DEFAULT_SETTINGS.animationMode),
        onionSkin: booleanSetting(data.onionSkin, DEFAULT_SETTINGS.onionSkin),
        onionOpacity: numberSetting(data.onionOpacity, DEFAULT_SETTINGS.onionOpacity, 0, 1),
        canvasBackdrop: enumSetting(data.canvasBackdrop, CANVAS_BACKDROPS, DEFAULT_SETTINGS.canvasBackdrop),
        minimap: booleanSetting(data.minimap, DEFAULT_SETTINGS.minimap),
        paletteSize: integerSetting(data.paletteSize, DEFAULT_SETTINGS.paletteSize, 1, 256),
        saveFormat: enumSetting(data.saveFormat, SAVE_FORMATS, DEFAULT_SETTINGS.saveFormat),
        saveColumns: integerSetting(data.saveColumns, DEFAULT_SETTINGS.saveColumns, 0),
        autoSaveRecent: booleanSetting(data.autoSaveRecent, DEFAULT_SETTINGS.autoSaveRecent),
        autoSaveCount: integerSetting(data.autoSaveCount, DEFAULT_SETTINGS.autoSaveCount, AUTO_SAVE_MIN, AUTO_SAVE_MAX),
        shareEraserSize: booleanSetting(data.shareEraserSize, DEFAULT_SETTINGS.shareEraserSize),
    };
}

export function saveSettings(settings: Settings): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // Ignore storage errors (e.g. private mode / quota).
    }
}
