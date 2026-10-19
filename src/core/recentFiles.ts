// Recent-files auto-save: keeps a copy of the working document (every frame
// and layer, the palette, the foreground color) in IndexedDB so work survives
// closing the site. There is no backend, so this is the only place "the last
// files you worked on" can live.
//
// Storage: IndexedDB database `pixelpalette-recents` with two stores.
//   meta  -> small RecentEntry records (name, size, savedAt, thumbnail, ...)
//   data  -> one project blob per entry (see core/project.ts)
//
// IndexedDB is used instead of localStorage because project blobs routinely
// exceed the ~5 MB localStorage quota; IndexedDB can hold far more, so the
// size guard is a policy choice (MAX_RECENT_BYTES) rather than a hard wall.

import { AUTO_SAVE_MAX, AUTO_SAVE_MIN } from './settings';
import { encodeProject } from './project';
import type { Store } from './store';

const DB_NAME = 'pixelpalette-recents';
const DB_VERSION = 1;
const META_STORE = 'meta';
const DATA_STORE = 'data';

// How often the working document is snapshotted ("every couple of minutes").
export const AUTOSAVE_INTERVAL_MS = 2 * 60 * 1000;

// Largest single auto-save.
export const MAX_RECENT_BYTES = 40 * 1024 * 1024;
// Budget for all kept auto-saves together: the default count of six files at
// their maximum size. Older files are dropped first.
const MAX_TOTAL_BYTES = 6 * MAX_RECENT_BYTES;

export interface RecentEntry {
    id: string;
    name: string;
    savedAt: number;
    width: number;
    height: number;
    frameCount: number;
    size: number; // project blob size in bytes
    thumbnail: string | null; // small PNG data URL of the current frame
}

export type AutoSaveResult =
    | 'saved'
    | 'skipped-disabled'
    | 'skipped-empty'
    | 'skipped-busy'
    | 'skipped-unchanged'
    | 'skipped-too-big'
    | 'failed';

export interface AutoSaveOptions {
    // Save even when nothing changed since the last snapshot (used when the
    // user saves the file normally).
    force?: boolean;
    // Display name for the entry, without extension.
    name?: string;
    // Pre-encoded project (e.g. the one just downloaded) to avoid encoding the
    // document twice during a manual save.
    blob?: Blob;
    // An explicit save requested by the user (Save dialog → Browser storage);
    // these run even while automatic auto-saving is disabled in Settings.
    manual?: boolean;
    // Keep this save as its own entry instead of updating the session's (Save
    // dialog → Browser storage → "separate file"). The session then continues
    // in the new entry, so the previous recent file stays untouched.
    separate?: boolean;
}

interface StoredData {
    id: string;
    blob: Blob;
}

let entries: RecentEntry[] = [];
let ready: Promise<boolean> | null = null;
let dbPromise: Promise<IDBDatabase | null> | null = null;
let saving = false;
// The document currently being worked on; its auto-saves update one entry.
let sessionId: string | null = null;
let sessionName = 'untitled';
let lastSavedRevision = -1;
let sizeWarned = false;

function createId(): string {
    return `p${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function openDatabase(): Promise<IDBDatabase | null> {
    if (dbPromise) {
        return dbPromise;
    }
    dbPromise = new Promise((resolve) => {
        let request: IDBOpenDBRequest;
        try {
            request = indexedDB.open(DB_NAME, DB_VERSION);
        } catch {
            resolve(null);
            return;
        }
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(META_STORE)) {
                db.createObjectStore(META_STORE, { keyPath: 'id' });
            }
            if (!db.objectStoreNames.contains(DATA_STORE)) {
                db.createObjectStore(DATA_STORE, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
    });
    return dbPromise;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

function normalizeEntry(value: unknown): RecentEntry | null {
    if (!value || typeof value !== 'object') {
        return null;
    }
    const entry = value as Partial<RecentEntry>;
    if (typeof entry.id !== 'string' || typeof entry.name !== 'string' || typeof entry.savedAt !== 'number') {
        return null;
    }
    return {
        id: entry.id,
        name: entry.name,
        savedAt: entry.savedAt,
        width: typeof entry.width === 'number' ? entry.width : 0,
        height: typeof entry.height === 'number' ? entry.height : 0,
        frameCount: typeof entry.frameCount === 'number' ? entry.frameCount : 1,
        size: typeof entry.size === 'number' ? entry.size : 0,
        thumbnail: typeof entry.thumbnail === 'string' ? entry.thumbnail : null,
    };
}

async function readMeta(db: IDBDatabase): Promise<RecentEntry[]> {
    const tx = db.transaction(META_STORE, 'readonly');
    const all = await requestResult(tx.objectStore(META_STORE).getAll() as IDBRequest<unknown[]>);
    await transactionDone(tx);
    return all
        .map(normalizeEntry)
        .filter((entry): entry is RecentEntry => entry !== null)
        .sort((a, b) => b.savedAt - a.savedAt);
}

function init(): Promise<boolean> {
    return (async () => {
        const db = await openDatabase();
        if (!db) {
            return false;
        }
        try {
            entries = await readMeta(db);
            return true;
        } catch {
            return false;
        }
    })();
}

function ensureReady(): Promise<boolean> {
    ready ??= init();
    return ready;
}

function makeThumbnail(image: ImageData): string | null {
    try {
        const max = 96;
        const scale = Math.min(1, max / Math.max(image.width, image.height));
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const source = document.createElement('canvas');
        source.width = image.width;
        source.height = image.height;
        source.getContext('2d')!.putImageData(image, 0, 0);
        const thumbnail = document.createElement('canvas');
        thumbnail.width = width;
        thumbnail.height = height;
        const context = thumbnail.getContext('2d');
        if (!context) {
            return null;
        }
        context.imageSmoothingEnabled = true;
        context.drawImage(source, 0, 0, width, height);
        return thumbnail.toDataURL('image/png');
    } catch {
        return null;
    }
}

// Starts auto-saving a document created in the app (New File, an opened or
// pasted image). The session is pinned to a fresh id — creation timestamp plus
// a random suffix — so its auto-saves always update their own entry and can
// never overwrite another document, even one with the same name.
export function beginNewSession(name?: string): void {
    beginSession(name, createId());
}

// Starts auto-saving a document that came from somewhere: `id` continues the
// recent entry it was loaded from (a recent tile); without one — a project
// opened from disk — the first auto-save continues the existing entry with the
// same name, if there is one.
export function beginSession(name?: string, id?: string): void {
    const trimmed = (name ?? '').trim();
    sessionName = trimmed === '' ? 'untitled' : trimmed;
    sessionId = id ?? null;
    lastSavedRevision = -1;
    sizeWarned = false;
}

// The current document's name: shown in the save dialog and on recent tiles.
// New documents keep the default until the user saves them with a name.
export function documentName(): string {
    return sessionName;
}

export async function listRecent(): Promise<RecentEntry[]> {
    if (!(await ensureReady())) {
        return [];
    }
    return entries.map((entry) => ({ ...entry }));
}

// The stored project for an entry (null when missing or storage unavailable).
export async function readRecent(id: string): Promise<Blob | null> {
    if (!(await ensureReady())) {
        return null;
    }
    const db = await openDatabase();
    if (!db) {
        return null;
    }
    try {
        const tx = db.transaction(DATA_STORE, 'readonly');
        const record = await requestResult(tx.objectStore(DATA_STORE).get(id) as IDBRequest<StoredData | undefined>);
        await transactionDone(tx);
        return record?.blob instanceof Blob ? record.blob : null;
    } catch {
        return null;
    }
}

export async function removeRecent(id: string): Promise<void> {
    if (!(await ensureReady())) {
        return;
    }
    const db = await openDatabase();
    if (!db) {
        return;
    }
    try {
        const tx = db.transaction([META_STORE, DATA_STORE], 'readwrite');
        tx.objectStore(META_STORE).delete(id);
        tx.objectStore(DATA_STORE).delete(id);
        await transactionDone(tx);
        entries = entries.filter((entry) => entry.id !== id);
    } catch {
        // Ignore storage errors.
    }
}

export async function clearRecent(): Promise<void> {
    const db = (await ensureReady()) ? await openDatabase() : null;
    if (db) {
        try {
            const tx = db.transaction([META_STORE, DATA_STORE], 'readwrite');
            tx.objectStore(META_STORE).clear();
            tx.objectStore(DATA_STORE).clear();
            await transactionDone(tx);
        } catch {
            // Ignore storage errors.
        }
    }
    entries = [];
}

// The id of the entry this session updates. A pinned id — assigned at creation
// (beginNewSession) or when a recent file was loaded — always wins, and is
// even reused if its entry was deleted. Only sessions without one (a project
// reopened from disk) continue an existing entry with the same name.
function resolveSessionId(): string {
    if (sessionId === null) {
        const byName = entries.find((entry) => entry.name.toLowerCase() === sessionName.toLowerCase());
        sessionId = byName ? byName.id : createId();
    }
    return sessionId;
}

// Writes the new entry and its project blob, and removes payloads of entries
// that no longer fit (dropped by count or size budget).
async function writeEntries(db: IDBDatabase, next: RecentEntry[], blob: Blob): Promise<void> {
    const tx = db.transaction([META_STORE, DATA_STORE], 'readwrite');
    const metaStore = tx.objectStore(META_STORE);
    const dataStore = tx.objectStore(DATA_STORE);
    metaStore.put(next[0]);
    dataStore.put({ id: next[0].id, blob } satisfies StoredData);
    for (const entry of entries) {
        if (!next.some((candidate) => candidate.id === entry.id)) {
            metaStore.delete(entry.id);
            dataStore.delete(entry.id);
        }
    }
    await transactionDone(tx);
}

// Snapshots the current document. Safe to call often: it bails out early
// unless the document changed (or the save is forced). Async because it reads
// and writes IndexedDB; callers that do not need the result can ignore it.
export async function autoSaveRecent(store: Store, options: AutoSaveOptions = {}): Promise<AutoSaveResult> {
    if (!store.settings.autoSaveRecent && !options.manual) {
        return 'skipped-disabled';
    }
    if (store.current === null || store.width === 0 || store.height === 0) {
        return 'skipped-empty';
    }
    if (store.working) {
        return 'skipped-busy';
    }
    if (saving) {
        return 'skipped-busy';
    }
    if (!options.force && store.revision === lastSavedRevision) {
        return 'skipped-unchanged';
    }
    if (!(await ensureReady())) {
        return 'failed';
    }
    const db = await openDatabase();
    if (!db) {
        return 'failed';
    }
    // The guard checks are repeated here because opening the database can take
    // a moment, during which the document may have changed.
    if (store.current === null || store.width === 0 || store.height === 0) {
        return 'skipped-empty';
    }
    if (!options.force && store.revision === lastSavedRevision) {
        return 'skipped-unchanged';
    }
    const revisionAtStart = store.revision;
    let blob: Blob;
    try {
        blob = options.blob ?? encodeProject(store);
    } catch {
        return 'failed';
    }
    if (blob.size > MAX_RECENT_BYTES) {
        if (!sizeWarned) {
            sizeWarned = true;
            const limitMb = Math.round(MAX_RECENT_BYTES / (1024 * 1024));
            store.setStatus(`Auto-save skipped: file is larger than ${limitMb} MB`);
        }
        return 'skipped-too-big';
    }
    const name = options.name?.trim();
    if (name) {
        sessionName = name;
    }
    // A "separate file" save pins the session to a brand-new entry, so this
    // snapshot cannot overwrite the recent file the document came from; later
    // auto-saves continue in the new entry.
    if (options.separate) {
        sessionId = createId();
    }
    const meta: RecentEntry = {
        id: resolveSessionId(),
        name: sessionName,
        savedAt: Date.now(),
        width: store.width,
        height: store.height,
        frameCount: store.frameCount,
        size: blob.size,
        thumbnail: makeThumbnail(store.current),
    };
    // Newest first, trimmed to the configured count and total budget. Only the
    // session's own entry is replaced; entries that merely share the name are
    // separate documents and stay.
    const count = Math.max(
        AUTO_SAVE_MIN,
        Math.min(Math.round(store.settings.autoSaveCount) || AUTO_SAVE_MIN, AUTO_SAVE_MAX),
    );
    let candidates = [meta, ...entries.filter((entry) => entry.id !== meta.id)].slice(0, count);
    let total = 0;
    candidates = candidates.filter((entry) => {
        total += entry.size;
        return total <= MAX_TOTAL_BYTES;
    });
    saving = true;
    try {
        while (candidates.length > 0) {
            try {
                await writeEntries(db, candidates, blob);
                entries = candidates;
                lastSavedRevision = revisionAtStart;
                return 'saved';
            } catch {
                if (candidates.length <= 1) {
                    return 'failed';
                }
                // Free the oldest entry and retry with fewer entries.
                candidates = candidates.slice(0, candidates.length - 1);
            }
        }
        return 'failed';
    } finally {
        saving = false;
    }
}
