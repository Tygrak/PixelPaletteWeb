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
  bucket, and text.
- **Brush library:** built-in brushes plus per-brush editing (tip, pressure
  curves, textures) with duplicate and custom brushes under Settings → Brush
  settings.
- **Selections:** marquee, lasso, magic wand, plus a floating transform for
  moving/scaling/rotating the selected pixels. The Move tool frames the layer's
  visible content the same way, so it can be scaled and rotated without a
  selection.
- **Symmetry modifiers:** mirror or rotational guides that copy brush strokes
  and fills live; the guide can be dragged directly on the image.
- **Palette lock modifier:** keep drawn pixels on the palette (hard, opaque
  palette colors even for soft brushes), and optionally recolor image pixels
  when a palette color is edited.
- **Layers:** add, duplicate, reorder, merge, delete, per-layer visibility, live
  compositing, and a compact layer list in the sidebar.
- **Animation:** a frame timeline with playback, onion skinning, and export as a
  sprite sheet or separate images.
- **Palette & dithering:** median-cut, K-means, HML-sector, hue-cluster and
  duo-tone palettes; threshold, random, ordered (Bayer), Floyd–Steinberg and
  min-average-error dithering.
- **Adjustments:** resize, rotate, flip, HSL shift, blur, and compare.
- **Effects:** Sobel edge detection with hysteresis and auto thresholds.
- **Project files:** save the whole session — every layer, frame and the
  palette — as a `.pixelpalette` file and reopen it later, instead of only
  exporting flattened images.
- **Auto-saved recent files:** the last few documents you worked on are kept
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
| Resize Image            | `R` |

Change the brush size with `[` and `]` (step of 1 while the size is 10 or
less, otherwise 2).

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
| Delete focused layer (after clicking a layer in the Layers list) | `Delete` / `Backspace` |
| Play / pause animation (Animation mode)  | `Space` |

## Layer shortcuts

| Action          | Shortcut            |
| --------------- | ------------------- |
| New Layer       | `Ctrl + N`          |
| Duplicate Layer | `Ctrl + D`          |
| Merge Down      | `Ctrl + E`          |

## Saving

**Save File** (`Ctrl + S`) offers several formats: a **project file**
(`.pixelpalette`) that keeps every layer and frame (plus the palette, brush
and modifier settings), **browser storage** (keeps a copy in the recent files
without downloading anything), the current frame, a sprite sheet grid, or
separate PNGs per frame. The name field starts from the document's own name —
new documents are "untitled" until saved with a name.
**Open File** reopens projects and images: the dialog can pick a file from
your computer, paste an image from the clipboard, accept a
dragged-and-dropped file, or load one of the recent auto-saves it lists.
Images can also be dropped anywhere on the start screen.

Independently of that, the app auto-saves your last few documents into the
browser's storage every couple of minutes and whenever you save. They are
shown as tiles on the start screen while no file is open. This can be turned
off, and the number of kept files changed, under
**Settings → Auto-save recent files**; documents larger than 40 MB are skipped
by design.

## Tablet / pen support

Drawing-tablet input uses the Pointer Events API: `PointerEvent.pressure`
(0–1) modulates brush/eraser size and opacity for `pen`/`touch` pointers, while
the mouse uses full pressure. Pen and touch behave like the mouse for all other
tools.
