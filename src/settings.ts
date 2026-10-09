// Locally-persisted user settings (localStorage).

export interface Settings {
  canvasWidth: number;
  canvasHeight: number;
  backgroundColor: string; // hex
  animationMode: boolean;
}

const STORAGE_KEY = 'pixelpalette.settings';

export const DEFAULT_SETTINGS: Settings = {
  canvasWidth: 1024,
  canvasHeight: 1024,
  backgroundColor: '#FFFFFF',
  animationMode: false,
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
