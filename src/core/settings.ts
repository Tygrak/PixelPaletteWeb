// Locally-persisted user settings (localStorage).

// What is shown behind the image (visible through transparent pixels).
export type CanvasBackdrop = 'checker' | 'black' | 'white';

// What the Save dialog exports.
export type SaveFormat = 'current' | 'grid' | 'separate';

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
    saveFormat: SaveFormat;
    saveColumns: number; // 0 = auto
    saveFileName: string; // base name without extension
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
    saveFormat: 'current',
    saveColumns: 0,
    saveFileName: 'image',
};

export function loadSettings(): Settings {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<Settings>;
            return { ...DEFAULT_SETTINGS, ...parsed };
        }
    } catch {
        // localStorage unavailable or corrupt; fall back to defaults.
    }
    return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: Settings): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
        // Ignore storage errors (e.g. private mode / quota).
    }
}
