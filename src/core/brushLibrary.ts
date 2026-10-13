// Locally-persisted brush library: the built-in defaults from brushes.ts plus
// the user's edits to those defaults and any custom brushes they add. Edits
// live in localStorage and subscribers are notified whenever the library
// changes, so brush pickers can refresh. The merged list is rebuilt whenever
// something changes, so callers should read brushes through allBrushes() /
// brushById() rather than caching brush objects across edits.

import { Brush, BRUSHES as DEFAULT_BRUSHES } from './brushes';

const STORAGE_KEY = 'pixelpalette.brushes';

interface StoredLibrary {
    // Edits to built-in brushes, keyed by id. A missing id means pristine default.
    overrides: Record<string, Brush>;
    // User-created brushes, in display order after the defaults.
    custom: Brush[];
}

type Listener = () => void;

export type BrushUpdate = Partial<Brush> | ((brush: Brush) => Partial<Brush>);

let overrides: Record<string, Brush> = {};
let custom: Brush[] = [];
let cache: Brush[] = [];
const listeners: Listener[] = [];

function cloneBrush(brush: Brush): Brush {
    return JSON.parse(JSON.stringify(brush)) as Brush;
}

function isDefaultId(id: string): boolean {
    return DEFAULT_BRUSHES.some((brush) => brush.id === id);
}

// Merges a stored brush over a known-good base so saves written by older
// versions pick up any fields added since. Brushes saved before the texture
// gained min/max stored a single `strength` that mapped coverage to
// [1 - strength, 1]; it is converted here.
function mergeBrush(base: Brush, stored: Partial<Brush>): Brush {
    const merged: Brush = {
        ...cloneBrush(base),
        ...stored,
        pressure: { ...base.pressure, ...(stored.pressure ?? {}) },
        texture: { ...base.texture, ...(stored.texture ?? {}) },
    };
    const legacy = stored.texture as unknown as { strength?: number; min?: number; max?: number } | undefined;
    if (legacy && typeof legacy.strength === 'number') {
        if (legacy.min === undefined && legacy.max === undefined) {
            merged.texture.min = 1 - legacy.strength;
            merged.texture.max = 1;
        }
        delete (merged.texture as unknown as Record<string, unknown>).strength;
    }
    return merged;
}

function rebuild(): void {
    const fallback = DEFAULT_BRUSHES[0];
    cache = [
        ...DEFAULT_BRUSHES.map((brush) => mergeBrush(brush, overrides[brush.id] ?? {})),
        ...custom.map((brush) => mergeBrush(fallback, brush)),
    ];
}

function load(): void {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw) as Partial<StoredLibrary>;
            if (parsed.overrides && typeof parsed.overrides === 'object') {
                overrides = parsed.overrides;
            }
            if (Array.isArray(parsed.custom)) {
                custom = parsed.custom.filter((brush) => brush && typeof brush.id === 'string' && !isDefaultId(brush.id));
            }
        }
    } catch {
        // Corrupt or unavailable storage; fall back to the built-in defaults.
        overrides = {};
        custom = [];
    }
    rebuild();
}

function persist(): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ overrides, custom } satisfies StoredLibrary));
    } catch {
        // Ignore storage errors (e.g. private mode / quota).
    }
}

function notify(): void {
    for (const listener of listeners) {
        listener();
    }
}

load();

// All brushes (defaults with any edits applied, then custom ones).
export function allBrushes(): Brush[] {
    return cache;
}

export function brushById(id: string): Brush {
    return cache.find((brush) => brush.id === id) ?? cache[0];
}

export function isDefaultBrush(id: string): boolean {
    return isDefaultId(id);
}

// True when a built-in brush has been edited away from its default settings.
export function isModifiedBrush(id: string): boolean {
    return id in overrides;
}

export function onBrushesChanged(listener: Listener): () => void {
    listeners.push(listener);
    return () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) {
            listeners.splice(index, 1);
        }
    };
}

export function updateBrush(id: string, update: BrushUpdate): void {
    const index = cache.findIndex((brush) => brush.id === id);
    if (index < 0) {
        return;
    }
    const current = cache[index];
    const patch = typeof update === 'function' ? update(current) : update;
    const updated: Brush = { ...cloneBrush(current), ...patch };
    if (isDefaultId(id)) {
        overrides[id] = updated;
    } else {
        const customIndex = custom.findIndex((brush) => brush.id === id);
        if (customIndex < 0) {
            return;
        }
        custom[customIndex] = updated;
    }
    rebuild();
    persist();
    notify();
}

// Adds a custom brush based on the given one (or the Round brush); returns its
// id. The copy is named after its source with the next free number appended.
export function addBrush(baseId?: string): string {
    const base = cache.find((brush) => brush.id === baseId) ?? cache[0];
    const brush = cloneBrush(base);
    brush.id = `custom-${Date.now().toString(36)}-${Math.floor(Math.random() * 46656).toString(36)}`;
    const taken = new Set(cache.map((existing) => existing.label));
    const stem = base.label.replace(/\s+\d+$/, '');
    let suffix = 2;
    while (taken.has(`${stem} ${suffix}`)) {
        suffix++;
    }
    brush.label = `${stem} ${suffix}`;
    custom.push(brush);
    rebuild();
    persist();
    notify();
    return brush.id;
}

// Removes a custom brush. Built-in brushes cannot be deleted (only reverted).
export function deleteBrush(id: string): boolean {
    if (isDefaultId(id)) {
        return false;
    }
    const remaining = custom.filter((brush) => brush.id !== id);
    if (remaining.length === custom.length) {
        return false;
    }
    custom = remaining;
    rebuild();
    persist();
    notify();
    return true;
}

// Restores a built-in brush to its default settings.
export function revertBrush(id: string): void {
    if (!isDefaultId(id) || !(id in overrides)) {
        return;
    }
    delete overrides[id];
    rebuild();
    persist();
    notify();
}
