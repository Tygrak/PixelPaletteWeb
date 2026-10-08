# PixelPalette (Web)

A local-only, client-side TypeScript port of **PixelPalette** — a dithering and
color-manipulation tool — plus an editing toolset (brushes, selections, layers).

Everything runs in the browser. There is **no server-side component**: images
are loaded from local files or the clipboard, processed on `<canvas>`, and
saved back to your machine. `npm run build` produces static files that can be
opened with no backend.

## Getting started

```bash
npm install
npm run dev      # development server (HMR)
npm run build    # typecheck + static production build into dist/
npm run preview  # serve the production build
```

---

## Tool Shortcuts (requirements)

| Tool                     | Key |
| ------------------------ | --- |
| Move Tool                | `V` |
| Hand (Pan) Tool          | `H` |
| Zoom Tool                | `Z` |
| Brush Tool               | `B` |
| Eraser Tool              | `E` |
| Paint Bucket Tool        | `G` |
| Lasso Tool               | `L` |
| Quick Selection / Wand   | `W` |
| Marquee Selection        | `M` |
| Eyedropper               | `I` |
| Text Tool                | `T` |
| Resize Image             | `R` |

## Editing & Navigation (requirements)

| Action | Shortcut |
| ------ | -------- |
| Undo   | `Ctrl + Z` |
| Redo   | `Ctrl + Shift + Z` (also `Ctrl + Y`) |
| Copy selection to clipboard | `Ctrl + C` |
| Paste image as new layer     | `Ctrl + V` |

## Working with Layers (requirements)

| Action        | Shortcut          |
| ------------- | ----------------- |
| New Layer     | `Shift + Ctrl + N` |
| Merge Down    | `Ctrl + E`         |

## Tablet / Pen support (requirements)

Drawing-tablet input is supported through the Pointer Events API:

- `PointerEvent.pressure` (0–1) modulates brush/eraser **size** and **opacity**
  while a `pen` or `touch` pointer is active.
- Mouse/other pointers use full pressure.
- Pen and touch input are handled the same as the mouse for all tools.

---

## Current Features

### Document & file

- Open local images (`png`, `jpg`, `jpeg`, `bmp`, `gif`, `webp`).
- **New File** creates a blank pure-white `1024 x 1024` document with 8 base
  colors in the palette (black, white, red, green, blue, yellow, cyan, magenta).
- Loading or pasting the **first** image automatically fills the palette with
  the image's 8 dominant colors (median cut), so you can start painting/dithering
  right away.
- Copying the current selection to the clipboard as a PNG with `Ctrl + C`
  (works with a marquee/lasso/wand selection or an in-progress floating
  transform).
- Pasting an image from the clipboard with `Ctrl + V` adds it as a **new layer**
  (centered on the document); if no document is open it opens one.
- Save the flattened document as `image.png`.
- Restore the document back to the originally opened image.
- Undo / redo history (up to 15 steps), via buttons and keyboard shortcuts.

### Viewing & navigation

- Zoom in/out with `Ctrl + mouse wheel` (anchored at the cursor).
- `Shift + wheel` pans horizontally; plain wheel pans vertically.
- Pan by dragging with the **Hand** tool, the middle mouse button, or by
  holding `Space` while dragging.
- **Zoom** tool: click to zoom in, `Alt`+click to zoom out.
- Fit-to-view and 100% presets in the tool options bar.
- Live zoom-percentage readout.
- Click (with the Hand tool, without dragging) copies the pixel's hex color to
  the clipboard.

### Tools

Each tool has an icon in the tool strip and a shortcut.

- **Move** – if a selection exists (from the marquee, lasso or wand tools) the
  Move tool acts on the **selected pixels**: a transform box appears around the
  selection and you can drag inside it to move, drag the edge/corner handles to
  scale, and drag just outside a corner to rotate. The cursor changes to match
  the handle under it.
  - Scaling anchors the **opposite edge/corner** by default, so dragging the
    right side grows the selection to the right (non-proportional). Hold
    `Shift` to scale about the center instead.
  - Hold `Alt` while starting the drag to **copy** the selection (the original
    stays in place; no new layer is created).
  - With no selection it moves the whole active layer.
  - `Enter` commits the transform, `Escape` cancels it.
- **Hand** – pan the view.
- **Zoom** – click to zoom in / `Alt`+click to zoom out.
- **Brush** – paint the foreground color with a round tip; **Soft** enables a
  feathered edge whose opacity falls off toward the rim; size and opacity are
  pressure-sensitive; stroke interpolation avoids gaps.
- **Eraser** – erase to transparency (with the same pressure behaviour).
- **Paint Bucket** – flood fill from the clicked pixel with the current color
  (adjustable tolerance, constrained by the active selection).
- **Lasso** – free-form polygonal selection.
- **Wand** – contiguous magic-wand selection with an adjustable tolerance.
- **Marquee** – rectangular selection. A plain click (no drag) clears the
  selection.
- **Eyedropper** – sample a color from the image into the brush foreground.
- **Text** – click on the canvas and type directly; the text appears in place
  at the chosen size/font/color. Backspace deletes, `Enter` locks it in, `Esc`
  cancels. Options: size, font (Sans/Serif/Mono/Cursive/Fantasy), bold, italic
  and color.
- **Resize Image** – a transform box around the canvas; drag its edges/corners
  to grow or shrink the document. By default this adds/removes empty canvas
  filled with the neighboring (edge) color; tick **Scale** to stretch the image
  content to the new size instead. Width/height and an optional locked ratio are
  also editable in the options bar.

Brush size can also be changed with `[` and `]`. Selections constrain the
brush and eraser to the selected region. `Esc` clears the selection.

The selection is outlined with a black/white checkerboard border so it is
visible on any image. For the **Marquee**, **Lasso** and **Wand** tools, hold
`Shift` to add to the current selection or `Alt` to subtract from it (no
modifier replaces it).

When the **Brush** or **Paint Bucket** tool is active, the options bar shows the
current palette as a row of swatches; click a swatch to make it the active
color (the active swatch is highlighted). `Alt`+click with either tool acts as
an eyedropper to sample a color from the image.

### Layers

- Docked **Layers** panel: list of layers with per-layer visibility toggles and
  an active-layer highlight.
- Double-click a layer to rename it; drag a layer to reorder the stack.
- New Layer (`Shift + Ctrl + N`), Merge Down (`Ctrl + E`, merges the active
  layer into the one below), Delete Layer.
- Layers are alpha-composited (source-over) for display, saving, and all
  processing operations.

### Palette panel

- Palette Colors: list of swatches; add / remove / clear; double-click a
  swatch to edit it.
- **Median Cut** palette generation (and a "Preview Median Cut" sort preview).
- **K-Means** clustering palette (configurable color count and max steps).
- **Sectors High / Mid / Low** palette generation.
- **Duo Tone** palette generation (hue/saturation, plus "add to palette").
- **Import / Export** palettes as hex text with a configurable separator.

### Dither panel

- **Threshold** – snap every pixel to the nearest palette color.
- **Random** – random dithering with a configurable bias.
- **Ordered** – ordered (Bayer) dithering with an editable 4×4 matrix.
- **2 Row** – Floyd–Steinberg error diffusion with an editable matrix.
- **3 Row** – Min-Average-Error error diffusion with an editable matrix.

### Adjustments panel

- **Transform**: resize (with optional locked aspect ratio), rotate 90°
  clockwise / counter-clockwise, flip horizontally / vertically.
- **HSL shift**: hue shift, saturation and lightness change.
- **Blur**: Gaussian-style separable blur with a configurable sigma.
- **Compare**: average color-distance and average brightness error against the
  original image or another image loaded from a file.

### Effects panel

- **Edge Detection**: Sobel gradient magnitude + hysteresis thresholding +
  dilation.
  - Edge width (thickness in pixels).
  - Edge color (color picker).
  - Thresholds, with an **Auto thresholds** mode that estimates the low/high
    thresholds from the image (mean + standard deviation of the gradient
    magnitude) so smooth gradients are ignored and the image is not
    over-detected. Turning Auto off exposes manual low/high thresholds.
  - Background: Black, White, or the Original image (edges overlaid on the
    source). Defaults to Original image.

### Color picker

- Non-modal floating panel (the rest of the UI stays visible and interactive).
- RGB (0–255), HSL, and hex inputs kept in sync, with a live preview.
- While open, clicking the image picks (eyedroppers) that pixel's color.

### Docked workspace panels

- Dither, Palette, Adjustments, Effects and Layers open as docked panels beside
  the sidebar (not modal windows) and can be open at the same time.
- Panels stack vertically; their combined column is resizable by dragging its
  right edge.
- The image remains fully interactive while panels are open.

---

## Architecture

```
src/
  main.ts            App shell, toolbar, tool routing, shortcuts, canvas render
  store.ts           Central state: layers, history, tools, selection, palette
  layers.ts          Layer model + alpha compositing
  tools.ts           Tool definitions, shortcuts, brush/eraser painting
  selection.ts       Marquee / lasso / wand masks + selection overlay
  floating.ts        Floating selection: lift, transform box, bake
  color.ts           Color helpers, HSL, hex, RGB<->XYZ<->Lab (System.Drawing semantics)
  image.ts           ImageData helpers, error metrics, resize/rotate/flip
  palette.ts         Median Cut, K-Means, HML, Duo Tone, sort
  dither.ts          Threshold, Floyd-Steinberg, MinAvgErr, Ordered, Random
  adjust.ts          HSL shift, blur
  effects.ts         Edge detection (Sobel + hysteresis + dilation)
  files.ts           Local file open/save + clipboard blob decode
  dom.ts             Small DOM helpers, dialog + docked-panel builders
  context.ts         AppContext shared with panels
  ui/
    palettePanel.ts
    ditherPanel.ts
    adjustmentsPanel.ts
    effectsPanel.ts
    layersPanel.ts
    selectColor.ts
```

## Notes & limitations

- Processing panels (Dither / Palette / Adjustments / Effects) operate on the
  **composited** document and write the result into the **active layer**.
- Resizing one layer moves/resizes all layers together (the document is
  resized as a whole).
- `Ctrl + Shift + N` cannot be intercepted in a few browsers (e.g. Chrome uses
  it to open an Incognito window); use the Layers panel button there.
- Undo history is capped at 15 steps.
