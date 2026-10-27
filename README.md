# PixelPalette (Web)

A client-side image editor originally created for dithering with some simple image editing capabilities added.

Try online [here](https://tygrak.github.io/PixelPaletteWeb/).

## Features

- Drawing tablet support
- Painting tools: brush, eraser, clone stamp, spot healing, palette knife, paint bucket, and text
- Selections: marquee, lasso, magic wand, and floating transforms
- Layers: nested groups, opacity, visibility, merging, reordering
- Drawing modifiers: symmetry, palette lock
- Brush library with editable and custom brushes
- Palette generation: median cut, K-means, duo tone...
- Dithering: threshold, random, ordered, error-diffusion...
- Adjustments: invert, grayscale, HSL shift, blur, drop shadow, edge detection, rotate and flip
- Animation: frame timeline, playback, onion skinning, and sprite sheet, PNG or GIF export
- Files: project files, image export, clipboard, undo/redo and auto-saved recent documents

## Development

```bash
npm install
npm run dev      # dev server with hot reload
npm run build    # typecheck + static production build into dist/
npm run preview  # serve the production build
```

