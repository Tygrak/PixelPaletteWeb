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
  moving/scaling/rotating the selected pixels.
- **Symmetry modifiers:** mirror or rotational guides that copy brush strokes
  and fills live; the guide can be dragged directly on the image.
- **Palette lock modifier:** snap drawn colors to the palette, and optionally
  recolor image pixels when a palette color is edited.
- **Layers:** add, duplicate, reorder, merge, delete, per-layer visibility, live
  compositing, and a compact layer list in the sidebar.
- **Animation:** a frame timeline with playback, onion skinning, and export as a
  sprite sheet or separate images.
- **Palette & dithering:** median-cut, K-means, HML-sector and duo-tone
  palettes; threshold, random, ordered (Bayer), Floyd–Steinberg and
  min-average-error dithering.
- **Adjustments:** resize, rotate, flip, HSL shift, blur, and compare.
- **Effects:** Sobel edge detection with hysteresis and auto thresholds.
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

Change the brush size with `[` and `]`.

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
| Play / pause animation (Animation mode)  | `Space` |

## Layer shortcuts

| Action          | Shortcut            |
| --------------- | ------------------- |
| New Layer       | `Ctrl + N`          |
| Duplicate Layer | `Ctrl + D`          |
| Merge Down      | `Ctrl + E`          |

## Tablet / pen support

Drawing-tablet input uses the Pointer Events API: `PointerEvent.pressure`
(0–1) modulates brush/eraser size and opacity for `pen`/`touch` pointers, while
the mouse uses full pressure. Pen and touch behave like the mouse for all other
tools.
