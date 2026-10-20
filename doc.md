# PixelPalette (Web)

Developer notes for the PixelPalette web app. For user-facing info see
[README.md](README.md).

## Tech stack

- **TypeScript** (strict) + **Vite**, no UI framework.
- Rendering and pixel work happen on `<canvas>` / `ImageData` in the browser.
- Everything is client-side; there is no backend.

Commands: `npm run dev`, `npm run build` (`tsc --noEmit && vite build`),
`npm run preview`, `npm run typecheck`.

## Directory map

```
src/
  main.ts            Entry + composition: app shell, pointer input, render()
  appStore.ts        Shared Store singleton (imported by all modules)
  context.ts         AppContext shared with UI panels
  shortcuts.ts       Global keyboard shortcuts (actions injected as hooks)
  shared/            Generic helpers; no app state
    color.ts         RGB/HSL/hex/Lab conversions, distances, averages
    image.ts         ImageData helpers, resize/rotate/flip, error metrics
    files.ts         Local file open/save, clipboard blob decode, text import/export
    gif.ts           Animated GIF encoder (LZW, palette, looping)
    dom.ts           Small DOM helpers, dialog + docked-panel/tabs/accordion builders
  core/              Document model + pixel processing
    store.ts         Central state: frames, layers, history, selection, tools
    settings.ts      Persisted user settings (localStorage)
    project.ts       Project file format (binary: all frames/layers/palette)
    recentFiles.ts   Recent-files auto-save in IndexedDB (crash recovery)
    gifExport.ts     Animation → shared palette + indexed frames → GIF
    layers.ts        Layer tree model + source-over compositing
    selection.ts     Marquee / lasso / wand masks + selection overlay
    floating.ts      Floating bitmap + transform box math, lift/bake
    text.ts          Rasterize the Text tool onto a layer
    tools.ts         Tool ids/shortcuts + per-stamp pixel algorithms
    brushes.ts       Data-driven brush definitions + coverage/texture math
    brushLibrary.ts  Brush overrides + custom brushes (persisted)
    palette.ts       Median Cut, K-Means, HML sectors, hue clusters, Duo Tone, sorting
    dither.ts        Threshold, Random, Ordered, Floyd–Steinberg, MinAvgErr
    adjust.ts        Invert/grayscale, HSL shift, separable blur
    effects.ts       Edge detection (Sobel + hysteresis + dilation)
    modifiers.ts     Symmetry guides, transforms, symmetrized fills, palette lock
  editor/            Interactive editing session state
    canvasView.ts    Canvas stack, zoom/pan, minimap, overlay, sampling
    paint.ts         Stroke session: stamps, symmetry copies, damage rectangles
    floatingSelection.ts  Floating selection session (move/scale/rotate)
    selectionDrag.ts In-progress marquee/lasso drag
    textTool.ts      On-canvas text editing + caret
  ui/                Chrome, built with createX(...) factories
    icons.ts         Tool-strip SVG icons + layer eye icons
    toolbar.ts       Top toolbar: file actions, undo/redo, status readouts
    optionsBar.ts    Per-tool options + palette strip
    panels.ts        Sidebar docked-panel toggles
    palettePanel.ts  Palette generation/editing
    ditherPanel.ts   Dithering
    adjustmentsPanel.ts  Common / HSL / blur / compare
    effectsPanel.ts  Edge detection
    layersPanel.ts   Full Layers panel (uses ui/layerList.ts)
    layerList.ts     Shared layer-tree list: selection, rename, drag & drop
    miniLayers.ts    Compact sidebar layers list
    newFileDialog.ts New file dialog (size presets / animation mode / clipboard image)
    timeline.ts      Animation timeline (frames, playback, onion skin)
    saveDialog.ts    Save/export dialog (project / current / grid / separate)
    openFileDialog.ts  Open dialog (disk / recent / clipboard / drag and drop)
    startScreen.ts   No-document screen: quick actions + recent-file tiles
    settingsPanel.ts Settings (includes the brush library editor)
    brushSettings.ts Brush library editor section
    modifiersPanel.ts  Modifier sections (symmetry, palette lock)
    selectColor.ts   Non-modal color picker
```

## Architecture overview

State lives in a single `Store` instance, created in `appStore.ts` and imported
by every module. Modules are grouped by responsibility:

- `shared/` — generic helpers with no app state (color/image math, DOM/file
  helpers).
- `core/` — the document model and pixel processing.
- `editor/` — interactive session state (strokes, selection drags, floating
  transforms, text editing, viewport).
- `ui/` — the chrome, built through factories (`createToolbar`,
  `createOptionsBar`, `createPanels`) and the docked panels.
- root — entry and composition (`main.ts`, `appStore.ts`, `context.ts`,
  `shortcuts.ts`).

Dependencies generally point toward `shared`/`core`; `main.ts` is the
composition root and wires callbacks and hooks.

`main.ts` builds the app shell with `h()` (from `shared/dom.ts`), assembles
toolbar/options bar/sidebar/canvas area, and owns pointer input, symmetry-guide
dragging, dock resizing, paste handling and the top-level `render()`.
`store.onChange(render)` subscribes `render()`, which re-syncs the UI whenever
the store emits.

There are two emit paths:

- `store.emit()` — lightweight change (tool, selection, settings). Listeners
  re-render UI chrome.
- `store.notify()` — the document's pixels changed. Invalidates the composite
  cache, bumps `revision`, and calls `emit()`.

`AppContext` (`context.ts`) is passed to UI panels. It exposes the store, the
dock element, and helpers such as `selectColor()`, `applyImage()`,
`applyPaletteToImage()`, `runTask()` and `saveImage()` so panels don't reach
into `main.ts` internals.

## The Store (`core/store.ts`)

### Frames and layers

The document is an array of **frames**; each `Frame` holds its own layer stack
and undo history:

```ts
interface Frame {
  id: number;
  layers: Layer[];
  activeIndex: number;
  contentRevision: number; // bumped on content change (used by onion-skin cache)
  undo: Snapshot[];
  redo: Snapshot[];
}
```

Even without animation there is always one frame. `store.layers` and
`store.activeIndex` are **accessors** that read/write `frames[currentFrame]`, so
all existing layer code works unchanged and switching frames swaps the live
document.

- `current` — the flattened composite (`compositeLayers`) used for display,
  sampling and export. Cached until `invalidate()`.
- `activeLayer` / `activeImage` — the current layer and its pixels.
- Frame API: `frameCount`, `frameId`, `frameRevision`, `frameComposite(i)`,
  `selectFrame`, `previewFrame` (playback, no selection reset), `addFrame`,
  `deleteFrame`, `moveFrame`.

### Layers (`core/layers.ts`)

The document is a **node tree**: `LayerNode = Layer | LayerGroup`, ordered
bottom to top. A `Layer` has `{ id, name, image, visible, opacity, offsetX,
offsetY }`; a `LayerGroup` has `{ id, name, visible, children }` and children
may be layers or further groups, so **groups nest arbitrarily**. Layers may
have different image sizes and offsets; `compositeLayers` flattens the visible
layers (a hidden group hides its whole subtree) and draws each at its offset,
clipped to the document bounds, using source-over alpha. A fast path returns
the single visible layer's image directly when there is no offset/opacity.
`flattenDisplayNodes` yields the top-first order the Layers lists render.

The shared list (`ui/layerList.ts`) drives both the Layers panel and the mini
list: click / Ctrl+click / Shift+click selection over nodes, inline rename,
per-node eye toggles and drag & drop. The store exposes node operations
(`selectNode`, `moveNodes`, `groupSelectedLayers`, `ungroupSelectedLayers`,
`mergeSelectedLayers`, `mergeLayers`, `duplicateLayer`, `deleteLayer`,
`renameNode`, `setNodeVisible`); the active layer is tracked by id and is
always a real layer (clicking a group focuses its topmost layer). Drop rules:
**onto a group header** = top of that group, **between rows** = the level of
the row below (so gaps inside a group stay inside it), **above a group header**
= above the group, and at the very bottom = below the last row. Groups can
never be moved into themselves. Group Layers (Ctrl+G) wraps the selected nodes
in a new group (needs two or more); with exactly one group selected, Ctrl+G
dissolves it (ungroups) instead. Ungroup dissolves selected groups into
their parents, Merge Selected (Ctrl+E, also merges a single selected group)
flattens selected nodes into one layer, and new layers/pastes go above the
active layer in its own group.

### History

Undo/redo is **per frame**, capped at `HISTORY_LIMIT = 30`. `pushHistory()`
stores a `Snapshot` (`nodes`, `activeId`, `width`, `height`, `palette`).
`undo()` moves the current state to the redo stack and restores the snapshot.
The palette is part of the snapshot so palette edits that recolored the image
(palette lock) revert together with the pixels.

`beginPaint()` records history and clones the active layer's image so an
in-place stroke keeps the pre-stroke pixels available for undo.

`changeMainImage(img)` replaces the active layer's image (used by the
processing panels). If the document has a single layer it also syncs
`width`/`height` — this keeps the canvas correct after rotating/resizing the
only layer.

### Selection & settings

`selection` is a `Uint8Array` mask in document space (see `core/selection.ts`).
`settings` (`core/settings.ts`) is persisted to `localStorage` under
`pixelpalette.settings` and merged over `DEFAULT_SETTINGS`, so new fields are
backward-compatible.

## Rendering pipeline (`editor/canvasView.ts`, `main.ts`)

The canvas area (owned by `editor/canvasView.ts`) contains a `.canvas-stack`
with two same-size canvases:

- the **main canvas** (`putImageData` of `store.current`), and
- the **overlay canvas** (selection marching ants, floating/transform boxes,
  symmetry guide, text caret, clone source marker, brush cursor, onion skin).

`render()` in `main.ts` runs on every store change and:

1. calls `refreshCanvas()`, which resizes the canvases when the document size
   changes, repaints pixels, applies the **backdrop** class to `.canvas-stack`,
   runs `applyCanvasLayout()` and `redrawOverlay()`, and refreshes the minimap;
2. syncs the chrome: toolbar, options bar, panel buttons, tool buttons, sidebar
   mini layers list, and the animation timeline.

Pixel repaints use the store's damage rectangles: after a local edit
(`store.notifyAreas()`, e.g. a stroke) only the dirty rectangles are copied with
`putImageData`; any other change repaints the full image.

Zoom/pan are `zoom`, `offsetX`, `offsetY`. `applyCanvasLayout()` sizes the
`.canvas-stack` to the displayed image and applies a `translate` transform;
`toImagePoint()` maps client coordinates back to document pixels.

When enabled in Settings, the **minimap** (bottom-right corner) shows a cached
downscaled thumbnail plus the viewport rectangle; clicking or dragging on it
pans the view (`panFromMinimap()`).

The **backdrop** (Settings → Image backdrop) is a CSS background on
`.canvas-stack`, so it shows through transparent pixels and is bounded to the
image: a checkerboard, pure black, or pure white.

**Onion skin** draws the previous frame on the overlay canvas at
`settings.onionOpacity`, only in animation mode, not during playback, and not on
the first frame. `getOnionCanvas()` caches the previous frame's composite keyed
by `frameId:contentRevision`, so it is not recomposited on every stroke.

## Input & the tool pipeline (`main.ts`, `editor/paint.ts`)

Pointer events (`pointerdown` / `pointermove` / `pointerup`) drive all canvas
interaction. While `store.playing` is true, input is ignored. `pointerPressure()`
returns the raw 0–1 reading for pen/touch and 1 otherwise. While the first
events of a stroke report 0 pressure (tablets often do as the pen ramps up) the
first stamp is deferred; it paints as soon as a move reports a real reading, or
at full pressure if the pointer lifts without one, so taps still register as
dots.

Painting tools (brush, eraser, clone, heal, knife) share a stroke session in
`editor/paint.ts`:

- `pointerdown` calls `store.beginPaint()` to get a mutable clone of the active
  layer, then starts the session (`startBrushStroke` / `startCloneStroke` /
  `startHealStroke` / `startKnifeStroke`). For brush/eraser, `Shift+click`
  starts at the previous stroke's end (`getLastPaintPoint()`) and paints one
  straight line to the clicked point instead of a new dot.
- `pointermove` calls `continueStroke(x, y, pressure, event.shiftKey)`, which
  interpolates stamps with `forEachStamp()` and dispatches to the right
  per-stamp routine. While Shift is held the stroke locks onto the horizontal
  or vertical axis through the point where Shift was pressed (never a jump),
  and releasing Shift resumes freehand from there.
- The affected rectangles are merged and flushed at most once per animation
  frame (`schedulePaintUpdate()` / `flushPaintUpdate()` → `store.notifyAreas()`);
  `pointerup` calls `endStroke()` to flush what is left.

Per-stamp pixel routines live in `core/tools.ts`; the tip mask, texture and
pressure math live in `core/brushes.ts`:

- `stampBrush` / `brushShape` / `brushCoverage` / `brushFootprint` — the shared
  tip mask (soft, hard-antialiased, or hard pixel) with optional lobes and
  rotation, modulated by texture and per-brush pressure curves.
- `cloneStamp` — copies from a pre-stroke snapshot at `cloneOffset`
  (`core/tools.ts`).
- `healStamp` — averages the ring around the brush and feathers it in.
- `knifeStamp` — samples paint slightly behind the cursor relative to the drag
  direction and smears it forward for the palette knife.
- `floodFill` — scanline flood fill. Color matching includes **alpha**, so
  transparent pixels never match opaque black on transparent images.

Other tools: the **Text** tool is an interactive session in `editor/textTool.ts`
(in-progress string + caret, committed on Enter); `core/text.ts` rasterizes it
and the result is applied through `ctx.applyImage`. The **Measure** tool
(`editor/measure.ts` holds the points) renders its line, endpoint dots and
`.measure-label` distance readout as DOM elements inside the canvas stack
(`redrawOverlay()` positions them from the displayed scale), so they stay
screen-sized and crisp at any zoom — canvas drawing would be magnified and
pixelated by the document-resolution overlay. Drag from one point to another,
the measurement stays visible while the tool is active, holding Shift snaps the
line to 45° increments, and Escape clears it (points are clamped to the
document). The **Move** tool shows a
transform box around the selected layers' visible content (or the selection) at
all times: dragging inside moves the layers/selection, the handles scale/rotate
— with no selection the framed content is lifted into the floating transform
when a handle is grabbed — and clicking outside commits. While dragging a scale
handle, `Shift` scales about the box center, `Alt` keeps the aspect ratio
(`computeScale`'s `altKey`), and `Shift+Alt` does both. Arrow keys nudge the
moving content one pixel at a time (Shift: ten pixels; with a pixel selection
the first press lifts it, like a drag); `nudgeMove()` and
`store.pushNudgeHistory()` keep a run of nudges in a single undo step. With several layers
selected in the Layers list (or a whole group selected) they move, scale and
rotate together while keeping their own pixels. The **Resize Image**
tool resizes the whole document via `store.resizeDocument`/`resizeCanvas`.

### Modifiers (`core/modifiers.ts`, `ui/modifiersPanel.ts`)

When symmetry is enabled, `symmetryTransforms()` returns the mirror or
rotational copies of the guide. Strokes (`editor/paint.ts`) and the paint
bucket (`applySymmetrizedFill`) draw every copy, and `drawSymmetryToContext()`
renders the guide on the overlay canvas. The Modifiers panel can put the guide
into transform mode, where dragging on the canvas moves or rotates it directly
(`main.ts` handles the drag).

The **Palette Lock** modifier (`store.paletteLock`) keeps paint on the palette:
while `enabled`, paint operations use `store.paintColor`
(`snapToPalette(foreground, palette)`) and paint hard, fully opaque pixels, so
soft brush edges cannot blend into off-palette or semi-transparent colors. The
sampled tools (clone, heal, knife) snap their colors through
`createPaletteSnap()` and also paint opaquely, and the paint bucket fills at full
opacity. Text uses `store.paintColor` for its color (its antialiased edge pixels
are not snapped). With `applyOnPaletteChange`, editing a palette entry through
`store.setPaletteColor()` (palette panel, options-bar strip) recolors every
matching pixel of the active layer to the new color; the edit is recorded in
history before the palette changes, so undo/redo revert palette and pixels
together, and Restore resets the palette to `store.initialPalette` (captured
when the document is opened) alongside the image. The panel also offers a
one-shot `ctx.applyPaletteToImage()` (`remapToPalette`, alpha-preserving nearest
color) to snap the whole layer to the palette. The Modifiers panel is built from
`accordionSection()` sections (shared with the brush editor in Settings).

### Brush library (`core/brushes.ts`, `core/brushLibrary.ts`, `ui/brushSettings.ts`)

Brushes are data-driven: `core/brushes.ts` defines the built-in `BRUSHES` and
the coverage/texture/pressure math. `core/brushLibrary.ts` layers user edits
(overrides) and custom brushes on top, persisted to `localStorage` under
`pixelpalette.brushes`; changes notify via `onBrushesChanged()`. The brush
pickers list `allBrushes()`, and the full editor lives in Settings.

## Selections & floating transforms

`core/selection.ts`: `rectSelection`, `polygonSelection` and `wandSelection`
build masks; `combineSelection` applies replace/add/subtract;
`selectionOverlay` renders the checkerboard border drawn on the overlay canvas.
The in-progress drag (marquee/lasso outline, mode capture) lives in
`editor/selectionDrag.ts` and only builds the real mask on release.

`core/floating.ts` holds the floating bitmap + transform box math
(`liftSelection`, `computeScale`, `bakeFloating`, `bakeFloatingPart`);
`editor/floatingSelection.ts` tracks the live session (current floating, drag
state, commit/cancel). The Move tool's box frames the selection when there is
one, otherwise the visible content of the layers it acts on (the active layer,
or every layer of a multi-selection); grabbing a handle lifts that content into
the floating transform. A multi-layer float keeps one `FloatingPart` per layer
and draws them as a single buffer, so scaling/rotating writes each layer's
transformed pixels back into its own layer instead of merging them. `Enter`
commits and `Escape` cancels.

## Animation (`ui/timeline.ts`, `core/store.ts`)

Enabled by Settings → Animation mode. The timeline lists frame thumbnails (each
a `frameComposite`), supports click-to-edit, drag-to-reorder, add (duplicate or
blank) and delete. Clicking a frame also focuses it, so `Delete` removes that
frame (see Keyboard shortcuts). The save dialog's **Animated GIF** format
exports the frames at the timeline FPS.

Playback uses a `setInterval` at the chosen FPS and advances
`store.previewFrame()`. While playing, `store.playing` blocks canvas input and
most shortcuts; `Space` toggles and `Esc` stops. On stop it returns to the frame
that was active when playback started. `Space` auto-repeat is ignored so holding
it doesn't flicker.

Onion skin and playback concerns are handled in `redrawOverlay()` and the
timeline `sync()` respectively.

## Processing panels

Dither, Palette, Adjustments and Effects all read from **`store.activeImage`**
(the active layer's own pixels) and write back with `ctx.applyImage()` →
`store.changeMainImage()`. They never operate on the flattened composite, so
they affect only the current layer. Exceptions that intentionally use the
composite: Compare (Adjustments), eyedropper sampling, wand selection, Copy
selection, and Save.

## Save & export (`ui/saveDialog.ts`, `shared/files.ts`)

The toolbar **Save File** button and `Ctrl + S` open the shared save dialog:

- **Project file** (`.pixelpalette`) — the app's own format with every layer
  and frame (see below),
- **Browser storage (no download)** — keeps a project copy in the recent
  files without downloading anything; explicit storage saves run even while
  automatic auto-saving is disabled in Settings. Its **Separate file**
  checkbox (shown only for Browser storage, disabled until that format is
  picked, and always disabled when the dialog opens) saves a brand-new recent
  entry instead of updating the one the document is already stored under — the
  session then continues in the new entry, so the previous recent file stays
  untouched,
- **Current frame**, **Sprite sheet (grid)** (configurable columns), or
  **Separate images** (`name_001.png`, …),
- **Animated GIF** — offered in animation mode with more than one frame;
  exports the frames at the timeline FPS as a looping GIF (`shared/gif.ts`
  holds the LZW/container encoder, `core/gifExport.ts` builds the shared
  palette and indexed pixels: exact for low-color art, median cut plus
  nearest-color snapping otherwise).
- The file name is pre-filled with the document's own name — new documents
  start as "untitled" and only gain a name when saved with one — while the
  format and columns are remembered (`settings.saveFormat` /
  `saveColumns`); the label next to the name shows the extension the selected
  format produces (hidden for browser storage). Every manual save also
  refreshes the document's recent-files auto-save.

`shared/files.ts` handles opening local images, saving PNGs via a download
link, and text import/export for palettes.

## Projects & recent files (`core/project.ts`, `core/recentFiles.ts`)

A project is a small binary container holding the whole session: every frame
and, per layer, its name, visibility, opacity, offsets and pixels. Layout:
`"PPAL"` magic + version + manifest length, then a JSON manifest (dimensions,
frames whose node trees hold layers/groups with an `imageIndex` per layer,
image byte lengths, palette, foreground color, the selected brush and size,
and the drawing modifier state — the symmetry guide and palette lock), then
the PNG blobs back to back. Version 3 stores the node tree; version 2 files
(flat layers + group table) are folded into groups on load. PNGs are stored
raw instead of as base64 data URLs inside JSON (which inflated them by 33%),
and pixel-identical images (e.g. duplicated layers) share one blob.
The original image the document was opened from is deliberately not stored — a
second full copy roughly doubled the file size — so on load Restore targets
the saved state, which is recomputed by compositing the loaded frame. The
guide's transform mode is transient and never restored; files written before
these fields existed keep the session's current brush/modifier settings (and
just recenter the guide).

Toolbar **Open File** (and the start screen's Open button) opens a dialog that
offers four ways in: choosing a file from disk, picking one of the recent
auto-saves, pasting an image from the clipboard, or dragging a file onto its
drop zone. `.pixelpalette` files restore the whole document; images open as a
new document (the palette is derived from them). Dropping an image or project
file anywhere on the empty start screen opens it directly, and dropping while
a document is open is ignored (the browser's default file-navigation is always
prevented). Projects are loaded through `store.openDocumentData()` (fresh
history; animation mode is enabled automatically for multi-frame projects).
The same encoder backs the downloads and the recent-files auto-save, so the
two can never drift apart.

`core/recentFiles.ts` keeps the last documents (default 20, configurable
1–50) in IndexedDB
(`pixelpalette-recents` database with a small `meta` store and a `data` store
holding one project blob per entry) so work survives closing the site:

- snapshots run every `AUTOSAVE_INTERVAL_MS` (2 minutes) when the document
  changed, on `visibilitychange`/`pagehide` (best effort — IndexedDB writes
  are asynchronous), and on every manual save;
- each document owns one entry: documents created in the app (New File, opened
  or pasted images) start as "untitled" — they only gain a name when saved
  with one — and are pinned to a fresh id (creation timestamp plus a random
  suffix) so they never overwrite one another; projects reopened from disk
  continue the existing entry with the same name, and recent tiles continue
  their own entry; the list is trimmed to `settings.autoSaveCount`. A save
  with the save dialog's **Separate file** option
  (`autoSaveRecent(..., { separate: true })`) skips all of that: it writes a
  brand-new entry and re-pins the session to it, so the recent file the
  document came from stays as it was;
- safeguards: a project over `MAX_RECENT_BYTES` (40 MB) is never auto-saved,
  the kept copies together stay under a 6 x 40 MB budget, and failed writes
  drop the oldest entries and retry before giving up. The toolbar status line
  notes when a file is skipped for size.

IndexedDB is used instead of localStorage because project blobs routinely
exceed the ~5 MB localStorage quota; the 40 MB guard is therefore a policy
limit rather than a hard wall.

While no document is open, the canvas area shows the start screen
(`ui/startScreen.ts`): the "Open, paste, drop or create a file to begin" actions
plus a grid of recent-file tiles (thumbnail, dimensions, size, age) that load
an entry directly. The same tiles are listed in the Open File dialog
(`ui/openFileDialog.ts`). Settings → Auto-save recent files toggles the whole
mechanism (default on, keeping 6 files), Settings → Recent files kept changes
the count (1–10), and Settings has a Clear button for the list.

## Settings persistence (`core/settings.ts`)

Settings are saved to `localStorage` and read at startup. Current fields:
`canvasWidth`, `canvasHeight`, `backgroundColor`, `blankNewImage`,
`animationMode`, `onionSkin`, `onionOpacity`, `canvasBackdrop`, `minimap`,
`paletteSize`, `saveFormat`, `saveColumns`, `autoSaveRecent`, `autoSaveCount`.

`paletteSize` is the number of colors generated from an imported image
(median cut). If the image contains fewer colors, the generated palette is
sized down to the number of distinct colors found.

## Keyboard shortcuts (`shortcuts.ts`)

All shortcuts are handled by `installShortcuts()` in `shortcuts.ts`. It ignores
input while typing in a field, routes `Ctrl` combinations (undo/redo/save/
copy/paste/new layer/duplicate/merge/group/rename), and maps single keys to
tools via `toolForShortcut()`. `Ctrl+R` renames the active layer inline and
replaces the browser's reload while a document is open: it uses the docked
Layers panel's list when that panel is open (`renameActiveLayerInPanel()`) and
the sidebar's mini list otherwise. Number keys pick palette colors (`1`-`9`,
`0` = tenth); with `Shift` held while a brush-based tool is active they pick
the same slot in the brush library (`digitIndex()` reads `event.code` so
shifted main-row digits keep working). Space is context-sensitive: it pans
(drag) normally, or
toggles animation playback in animation mode. While the Text tool is editing, it
handles Escape/Enter/Backspace/characters instead. `Delete`/`Backspace` clears
the selection, or deletes the focused frame / focused layer: clicking a
timeline frame sets `store.frameFocus`, clicking a row in the mini/full Layers
lists sets `store.layerFocus`, and clicks elsewhere (in `main.ts`) clear both;
a focused frame wins. Actions that belong to the app wiring (saving, tool
selection, timeline, space-pan state) are injected as hooks by `main.ts`.

## Build & deployment

Vite outputs a static `dist/` with `base: './'`, so it works from any
sub-path. `.github/workflows/deploy.yml` builds and deploys `dist/` to GitHub
Pages on pushes to `main` (set **Settings → Pages → Source = GitHub Actions**
once).

## Notes & limitations

- Processing panels act on the **active layer**; the **Resize Image** tool acts
  on the whole document (all layers).
- Undo history is capped at 30 steps and is tracked per animation frame.
- `Ctrl + N` (new layer) can be captured by the browser in some cases;
  the Layers panel's button always works.
- Layers may differ in size/offset from the document; compositing clips them to
  the document bounds.
