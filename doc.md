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
    dom.ts           Small DOM helpers, dialog + docked-panel/tabs/accordion builders
  core/              Document model + pixel processing
    store.ts         Central state: frames, layers, history, selection, tools
    settings.ts      Persisted user settings (localStorage)
    layers.ts        Layer model + source-over compositing
    selection.ts     Marquee / lasso / wand masks + selection overlay
    floating.ts      Floating bitmap + transform box math, lift/bake
    text.ts          Rasterize the Text tool onto a layer
    tools.ts         Tool ids/shortcuts + per-stamp pixel algorithms
    brushes.ts       Data-driven brush definitions + coverage/texture math
    brushLibrary.ts  Brush overrides + custom brushes (persisted)
    palette.ts       Median Cut, K-Means, HML sectors, hue clusters, Duo Tone, sorting
    dither.ts        Threshold, Random, Ordered, Floyd–Steinberg, MinAvgErr
    adjust.ts        HSL shift, separable blur
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
    adjustmentsPanel.ts  Transform / HSL / blur / compare
    effectsPanel.ts  Edge detection
    layersPanel.ts   Full Layers panel
    miniLayers.ts    Compact sidebar layers list
    newFileDialog.ts New file dialog (size / clipboard image)
    timeline.ts      Animation timeline (frames, playback, onion skin)
    saveDialog.ts    Save/export dialog (current / grid / separate)
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

A `Layer` has `{ id, name, image, visible, opacity, offsetX, offsetY }`.
Layers may have different image sizes and offsets; `compositeLayers` draws each
visible layer at its offset, clipped to the document bounds, using source-over
alpha. A fast path returns the single visible layer's image directly when there
is no offset/opacity.

### History

Undo/redo is **per frame**, capped at `HISTORY_LIMIT = 15`. `pushHistory()`
stores a `Snapshot` (`layers`, `activeIndex`, `width`, `height`, `palette`).
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
returns 0.02–1 for pen/touch and 1 otherwise.

Painting tools (brush, eraser, clone, heal, knife) share a stroke session in
`editor/paint.ts`:

- `pointerdown` calls `store.beginPaint()` to get a mutable clone of the active
  layer, then starts the session (`startBrushStroke` / `startCloneStroke` /
  `startHealStroke` / `startKnifeStroke`).
- `pointermove` calls `continueStroke(x, y, pressure)`, which interpolates
  stamps with `forEachStamp()` and dispatches to the right per-stamp routine.
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
and the result is applied through `ctx.applyImage`. The **Move** tool either
offsets the active layer or lifts the selection into a floating transform (see
below); the **Resize Image** tool resizes the whole document via
`store.resizeDocument`/`resizeCanvas`.

### Modifiers (`core/modifiers.ts`, `ui/modifiersPanel.ts`)

When symmetry is enabled, `symmetryTransforms()` returns the mirror or
rotational copies of the guide. Strokes (`editor/paint.ts`) and the paint
bucket (`applySymmetrizedFill`) draw every copy, and `drawSymmetryToContext()`
renders the guide on the overlay canvas. The Modifiers panel can put the guide
into transform mode, where dragging on the canvas moves or rotates it directly
(`main.ts` handles the drag).

The **Palette Lock** modifier (`store.paletteLock`) keeps paint on the palette:
while `enabled`, paint operations use `store.paintColor`, which is
`snapToPalette(foreground, palette)` (brush, paint bucket, text and its on-canvas
preview). With `applyOnPaletteChange`, editing a palette entry through
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
(`liftSelection`, `computeScale`, `bakeFloating`); `editor/floatingSelection.ts`
tracks the live session (current floating, drag state, commit/cancel). The Move
tool drags handles to translate/scale/rotate, `Enter` commits and `Escape`
cancels.

## Animation (`ui/timeline.ts`, `core/store.ts`)

Enabled by Settings → Animation mode. The timeline lists frame thumbnails (each
a `frameComposite`), supports click-to-edit, drag-to-reorder, add (duplicate or
blank) and delete.

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

- **Current frame**, **Sprite sheet (grid)** (configurable columns), or
  **Separate images** (`name_001.png`, …).
- The file name is sanitized and remembered, as are the format and columns
  (`settings.saveFormat` / `saveColumns` / `saveFileName`).

`shared/files.ts` handles opening local images, saving PNGs via a download
link, and text import/export for palettes.

## Settings persistence (`core/settings.ts`)

Settings are saved to `localStorage` and read at startup. Current fields:
`canvasWidth`, `canvasHeight`, `backgroundColor`, `blankNewImage`,
`animationMode`, `onionSkin`, `onionOpacity`, `canvasBackdrop`, `minimap`,
`paletteSize`, `saveFormat`, `saveColumns`, `saveFileName`.

`paletteSize` is the number of colors generated from an imported image
(median cut). If the image contains fewer colors, the generated palette is
sized down to the number of distinct colors found.

## Keyboard shortcuts (`shortcuts.ts`)

All shortcuts are handled by `installShortcuts()` in `shortcuts.ts`. It ignores
input while typing in a field, routes `Ctrl` combinations (undo/redo/save/
copy/paste/new layer/duplicate/merge), and maps single keys to tools via
`toolForShortcut()`. Space is context-sensitive: it pans (drag) normally, or
toggles animation playback in animation mode. While the Text tool is editing, it
handles Escape/Enter/Backspace/characters instead. Actions that belong to the
app wiring (saving, tool selection, timeline, space-pan state) are injected as
hooks by `main.ts`.

## Build & deployment

Vite outputs a static `dist/` with `base: './'`, so it works from any
sub-path. `.github/workflows/deploy.yml` builds and deploys `dist/` to GitHub
Pages on pushes to `main` (set **Settings → Pages → Source = GitHub Actions**
once).

## Notes & limitations

- Processing panels act on the **active layer**; the **Resize Image** tool acts
  on the whole document (all layers).
- Undo history is capped at 15 steps and is tracked per animation frame.
- `Ctrl + N` (new layer) can be captured by the browser in some cases;
  the Layers panel's button always works.
- Layers may differ in size/offset from the document; compositing clips them to
  the document bounds.
