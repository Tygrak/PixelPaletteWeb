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
  main.ts            App shell: DOM, toolbar, tool routing, input, render loop
  store.ts           Central state: frames, layers, history, selection, tools
  layers.ts          Layer model + source-over compositing
  tools.ts           Tool ids/shortcuts + per-stamp pixel algorithms
  selection.ts       Marquee / lasso / wand masks + selection overlay
  floating.ts        Floating selection: lift, transform box, bake
  text.ts            Rasterize the Text tool onto a layer
  color.ts           RGB/HSL/hex conversions, distances, Lab helpers
  image.ts           ImageData helpers, resize/rotate/flip, error metrics
  palette.ts         Median Cut, K-Means, HML sectors, Duo Tone, sorting
  dither.ts          Threshold, Random, Ordered, Floyd–Steinberg, MinAvgErr
  adjust.ts          HSL shift, separable blur
  effects.ts         Edge detection (Sobel + hysteresis + dilation)
  files.ts           Local file open/save, clipboard blob decode
  settings.ts        Persisted user settings (localStorage)
  dom.ts             Small DOM helpers, dialog + docked-panel/tabs builders
  context.ts         AppContext shared with UI panels
  icons.ts           Tool-strip SVG icons + layer eye icons
  ui/
    palettePanel.ts  Palette generation/editing
    ditherPanel.ts   Dithering
    adjustmentsPanel.ts  Transform / HSL / blur / compare
    effectsPanel.ts  Edge detection
    layersPanel.ts   Full Layers panel
    miniLayers.ts    Compact sidebar layers list
    timeline.ts      Animation timeline (frames, playback, onion skin)
    saveDialog.ts    Save/export dialog (current / grid / separate)
    settingsPanel.ts Settings
    selectColor.ts   Non-modal color picker
```

## Architecture overview

State lives in a single `Store` instance (`main.ts` creates `const store = new
Store()`). The DOM is built once in `main.ts` using the `h()` helper from
`dom.ts`. `store.onChange(render)` subscribes the top-level `render()` function,
which re-syncs the whole UI whenever the store emits.

There are two emit paths:

- `store.emit()` — lightweight change (tool, selection, settings). Listeners
  re-render UI chrome.
- `store.notify()` — the document's pixels changed. Invalidates the composite
  cache, bumps `revision`, and calls `emit()`.

`AppContext` (`context.ts`) is passed to UI panels. It exposes the store, the
dock element, and helpers such as `selectColor()`, `applyImage()`, `runTask()`
and `saveImage()` so panels don't reach into `main.ts` internals.

## The Store (`store.ts`)

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

### Layers (`layers.ts`)

A `Layer` has `{ id, name, image, visible, opacity, offsetX, offsetY }`.
Layers may have different image sizes and offsets; `compositeLayers` draws each
visible layer at its offset, clipped to the document bounds, using source-over
alpha. A fast path returns the single visible layer's image directly when there
is no offset/opacity.

### History

Undo/redo is **per frame**, capped at `HISTORY_LIMIT = 15`. `pushHistory()`
stores a `Snapshot` (`layers`, `activeIndex`, `width`, `height`). `undo()`
moves the current state to the redo stack and restores the snapshot.

`beginPaint()` records history and clones the active layer's image so an
in-place stroke keeps the pre-stroke pixels available for undo.

`changeMainImage(img)` replaces the active layer's image (used by the
processing panels). If the document has a single layer it also syncs
`width`/`height` — this keeps the canvas correct after rotating/resizing the
only layer.

### Selection & settings

`selection` is a `Uint8Array` mask in document space (see `selection.ts`).
`settings` (`settings.ts`) is persisted to `localStorage` under
`pixelpalette.settings` and merged over `DEFAULT_SETTINGS`, so new fields are
backward-compatible.

## Rendering pipeline (`main.ts`)

The canvas area contains a `.canvas-stack` with two same-size canvases:

- the **main canvas** (`putImageData` of `store.current`), and
- the **overlay canvas** (selection marching ants, transform boxes, text caret,
  hover cursor, onion skin).

`render()` runs on every store change and:

1. resizes the canvases to the document size when needed;
2. `putImageData(store.current, 0, 0)` when `revision` changed;
3. applies the current **backdrop** class to `.canvas-stack`;
4. calls `applyCanvasLayout()` (zoom/pan fit) and `redrawOverlay()`;
5. syncs tool buttons, options-bar inputs, disabled states, the sidebar mini
   layers list, and the animation timeline.

Zoom/pan are `zoom`, `offsetX`, `offsetY`. `applyCanvasLayout()` sizes the
`.canvas-stack` to the displayed image and applies a `translate` transform;
`toImagePoint()` maps client coordinates back to document pixels.

The **backdrop** (Settings → Image backdrop) is a CSS background on
`.canvas-stack`, so it shows through transparent pixels and is bounded to the
image: a checkerboard, pure black, or pure white.

**Onion skin** draws the previous frame on the overlay canvas at
`settings.onionOpacity`, only in animation mode, not during playback, and not on
the first frame. `getOnionCanvas()` caches the previous frame's composite keyed
by `frameId:contentRevision`, so it is not recomposited on every stroke.

## Input & the tool pipeline (`main.ts`)

Pointer events (`pointerdown` / `pointermove` / `pointerup`) drive all canvas
interaction. While `store.playing` is true, input is ignored. `pointerPressure()`
returns 0.02–1 for pen/touch and 1 otherwise.

Painting tools (brush, eraser, clone, heal, knife) share a stroke session:

- `pointerdown` calls `store.beginPaint()` to get a mutable clone of the active
  layer, sets `strokeKind`, and records the start point.
- `pointermove` calls `paintStrokeSegment(from, to)`, which interpolates stamps
  with `forEachStamp()` and dispatches to the right per-stamp routine in
  `tools.ts`; `store.notify()` redraws once per segment.
- `pointerup` clears the session.

Pixel primitives live in `tools.ts`:

- `stampBrush` / `coverageAt` / `coverageFor` / `pencilOffsets` — the shared
  round-tip mask (soft, hard-antialiased, or hard pencil).
- `cloneStamp` — copies from a pre-stroke snapshot at `cloneOffset`.
- `healStamp` — averages the ring around the brush and feathers it in.
- `knifeStamp` — samples paint slightly behind the cursor relative to the drag
  direction and smears it forward for the palette knife.
- `floodFill` — scanline flood fill. Color matching includes **alpha**, so
  transparent pixels never match opaque black on transparent images.

Other tools: the **Text** tool rasterizes with `text.ts` and commits through
`ctx.applyImage`; the **Move** tool either offsets the active layer or lifts the
selection into a floating transform (`floating.ts`); the **Resize Image** tool
resizes the whole document via `store.resizeDocument`/`resizeCanvas`.

## Selections & floating transforms (`selection.ts`, `floating.ts`)

`rectSelection`, `polygonSelection` and `wandSelection` build masks;
`combineSelection` applies replace/add/subtract; `selectionOverlay` renders the
checkerboard border drawn on the overlay canvas.

A floating selection is a lifted bitmap plus a transform box. `liftSelection`
clears the selected pixels (or copies), the Move tool drags handles to
translate/scale/rotate, and `bakeFloating` composites it back. `Enter` commits,
`Escape` cancels.

## Animation (`ui/timeline.ts`, `store.ts`)

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

## Save & export (`ui/saveDialog.ts`, `files.ts`)

The toolbar **Save File** button and `Ctrl + S` open the shared save dialog:

- **Current frame**, **Sprite sheet (grid)** (configurable columns), or
  **Separate images** (`name_001.png`, …).
- The file name is sanitized and remembered, as are the format and columns
  (`settings.saveFormat` / `saveColumns` / `saveFileName`).

`files.ts` handles opening local images, saving PNGs via a download link, and
text import/export for palettes.

## Settings persistence (`settings.ts`)

Settings are saved to `localStorage` and read at startup. Current fields:
`canvasWidth`, `canvasHeight`, `backgroundColor`, `blankNewImage`,
`animationMode`, `onionSkin`, `onionOpacity`, `canvasBackdrop`, `saveFormat`,
`saveColumns`, `saveFileName`.

## Keyboard shortcuts

All shortcuts are handled in the `keydown` listener in `main.ts`. It ignores
input while typing in a field, routes `Ctrl` combinations (undo/redo/save/
copy/paste/new layer/duplicate/merge), and maps single keys to tools via
`toolForShortcut()`. Space is context-sensitive: it pans (drag) normally, or
toggles animation playback in animation mode.

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
