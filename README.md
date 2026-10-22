# PixelPalette (Web)

A client-side image editor originally created for dithering with some simple image editing capabilities added.

## Getting started

Try online [here](https://tygrak.github.io/PixelPaletteWeb/)

Locally:
```bash
npm install
npm run dev      # dev server with hot reload
npm run build    # typecheck + static production build into dist/
npm run preview  # serve the production build
```

## Features

- **Painting:** brush, eraser, clone stamp, spot healing, palette knife, paint
  bucket, and text (with an optional soft drop shadow while typing; the arrow
  keys nudge the text being written — hold `Shift` for ten pixels). `Shift+click` with the brush or eraser continues from the
  previous stroke's end with a straight line, and holding `Shift` mid-stroke
  locks the brush to a horizontal or vertical line from the point where Shift
  was pressed (releasing it resumes freehand, with no jump).
- **Measure tool:** drag on the canvas to measure the distance between two
  points; the line stays visible (with a pixel distance label) until the next
  measurement or `Esc`. Hold `Shift` to snap the line to 45° increments.
- **Brush library:** built-in brushes plus per-brush editing (tip, pressure
  curves, textures) with duplicate and custom brushes under Settings → Brush
  settings.
- **Selections:** marquee, lasso, magic wand, plus a floating transform for
  moving/scaling/rotating the selected pixels. The Move tool frames the layer's
  visible content the same way, so it can be scaled and rotated without a
  selection; while scaling, `Shift` scales about the box center, `Alt` keeps
  the aspect ratio, and `Shift + Alt` does both. With the Move tool selected,
  the arrow keys nudge by one pixel — hold `Shift` for ten (consecutive nudges
  undo together).
- **Symmetry modifiers:** mirror or rotational guides that copy brush strokes
  and fills live; the guide can be dragged directly on the image.
- **Palette lock modifier:** keep drawn pixels on the palette (hard, opaque
  palette colors even for soft brushes), and optionally recolor image pixels
  when a palette color is edited.
- **Layers:** a layer tree with **nested groups** (groups inside groups), add,
  duplicate, reorder, drag & drop into/out of groups, merge, delete,
  per-layer and per-group visibility, an opacity slider for the selected
  layers/groups (groups blend as one unit), live compositing, multi-selection
  for grouping and merging, and a compact layer list in the sidebar.
  Right-clicking a row in either list opens a menu with the opacity slider and
  every selection operation (rename, duplicate, merge down/selected, group,
  ungroup, delete).
- **Animation:** a frame timeline with playback, onion skinning, and export as a
  sprite sheet, separate images, or a looping animated GIF.
- **Palette & dithering:** median-cut, K-means, HML-sector, hue-cluster and
  duo-tone palettes; threshold, random, ordered (Bayer), Floyd–Steinberg and
  min-average-error dithering.
- **Adjustments:** invert colors, grayscale, rotate, flip, HSL shift, blur,
  drop shadow (color, offset X/Y, softness, opacity — 100% by default — and a
  connect-to-layer sweep that closes the gap between the layer and its shadow),
  Sobel edge detection with hysteresis and auto thresholds, and compare — all
  in one Adjustments panel.
- **Project files:** save the whole session — every layer, frame and the
  palette — as a `.pixelpalette` file and reopen it later, instead of only
  exporting flattened images.
- **Auto-saved recent files:** the last 20 documents you worked on are kept
  in the browser automatically (also when you save normally) and shown as
  tiles on the start screen when no file is open. Configurable and toggleable
  in Settings; files larger than 40 MB are skipped.
- Clipboard copy/paste, undo/redo, customizable save name/format, a
  checkerboard / black / white image backdrop, and an optional minimap for
  panning while zoomed in.

## Tool shortcuts

| Tool                    | Key |
| ----------------------- | --- |
| Move                    | `V` |
| Hand (Pan)              | `H` |
| Zoom                    | `Z` |
| Brush                   | `B` |
| Eraser                  | `E` |
| Clone Stamp             | `S` |
| Spot Healing Brush      | `J` |
| Palette Knife           | `K` |
| Paint Bucket            | `G` |
| Lasso                   | `L` |
| Quick Selection / Wand  | `W` |
| Marquee Selection       | `M` |
| Eyedropper              | `I` |
| Text                    | `T` |
| Measure                 | `U` |
| Resize Image            | `R` |

Change the brush size with `[` and `]` (step of 1 while the size is 10 or
less, otherwise 2). Number keys pick palette colors (`1`-`9`, `0` for the
tenth); while a brush tool (Brush, Eraser, Clone, Heal, Knife) is active, hold
`Shift` with a number to pick the same slot in the brush library instead
(`Shift + 1` = Round, `Shift + 2` = Soft Round, ...). With `Alt` held, the
brackets and numbers navigate layers instead (see below).

## Editing shortcuts

| Action                                   | Shortcut |
| ---------------------------------------- | -------- |
| Undo                                     | `Ctrl + Z` |
| Redo                                     | `Ctrl + Shift + Z` (also `Ctrl + Y`) |
| Save (opens the save dialog)             | `Ctrl + S` |
| Copy selection to clipboard              | `Ctrl + C` |
| Paste image as a new layer               | `Ctrl + V` |
| Deselect                                 | `Esc` |
| Delete selection (to transparency)       | `Delete` / `Backspace` |
| Delete focused layer or group (after clicking it in the Layers list) | `Delete` / `Backspace` |
| Delete focused frame (after clicking a frame in the timeline) | `Delete` / `Backspace` |
| Play / pause animation (Animation mode)  | `Space` |

## Layer shortcuts

| Action          | Shortcut            |
| --------------- | ------------------- |
| New Layer       | `Ctrl + N`          |
| Duplicate Layer | `Ctrl + D`          |
| Merge Down (or merge the selected layers when several are selected) | `Ctrl + E` |
| Group Selected Layers (needs two or more selected) | `Ctrl + G` |
| Ungroup (same shortcut, with only a group selected) | `Ctrl + G` |
| Rename the active layer (inline, in the visible Layers list) | `Ctrl + R` |
| Focus the layer below / above | `Alt + [` / `Alt + ]` |
| Focus a layer by its position from the top (`1` = topmost) | `Alt + 1` ... `Alt + 9` |

## Saving

**Save File** (`Ctrl + S`) offers several formats: a **project file**
(`.pixelpalette`) that keeps every layer and frame (plus the palette, brush
and modifier settings), **browser storage** (keeps a copy in the recent files
without downloading anything; its **Separate file** checkbox keeps the save as
its own recent file instead of updating the one the document is already stored
under), the current frame, a sprite sheet grid,
separate PNGs per frame, or — in animation mode with more than one frame — a
looping **animated GIF** at the timeline FPS. The name field starts from the
document's own name — new documents are "untitled" until saved with a name.
**Open File** reopens projects and images: the dialog can pick a file from
your computer, paste an image from the clipboard, accept a
dragged-and-dropped file, or load one of the recent auto-saves it lists.
Images can also be dropped anywhere on the start screen.

Independently of that, the app auto-saves your last 20 documents into the
browser's storage every couple of minutes and whenever you save. They are
shown as tiles on the start screen while no file is open. This can be turned
off, and the number of kept files changed (1–50, default 20), under
**Settings → Auto-save recent files**; documents larger than 40 MB are skipped
by design.

## Tablet / pen support

Drawing-tablet input uses the Pointer Events API: `PointerEvent.pressure`
(0–1) modulates brush/eraser size and opacity for `pen`/`touch` pointers, while
the mouse uses full pressure. Pen and touch behave like the mouse for all other
tools.
