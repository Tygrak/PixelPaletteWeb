import { colorToHex, colorToHsl, hexToColor, hslToColor, RGB } from '../color';
import { createDialog, h, num, numeric, row } from '../dom';

const HEX_PATTERN = /^#?[0-9a-fA-F]{6}$/;

// The color picker is a non-modal floating panel. While it is open, the main
// canvas routes clicks here so the user can sample a color from the image.
let activePicker: ((color: RGB) => void) | null = null;

export function getActiveColorPicker(): ((color: RGB) => void) | null {
  return activePicker;
}

export function selectColorDialog(initial?: RGB): Promise<RGB> {
  return new Promise<RGB>((resolve) => {
    let current: RGB = initial ? { ...initial } : { r: 0, g: 0, b: 0 };
    let colorChanged = false;

    const rInput = numeric(0, { min: 0, max: 255 });
    const gInput = numeric(0, { min: 0, max: 255 });
    const bInput = numeric(0, { min: 0, max: 255 });
    const hInput = numeric(0, { min: 0, max: 360 });
    const sInput = numeric(0, { min: 0, max: 1, step: 0.01 });
    const lInput = numeric(0, { min: 0, max: 1, step: 0.01 });
    rInput.title = 'Red channel, from 0 to 255.';
    gInput.title = 'Green channel, from 0 to 255.';
    bInput.title = 'Blue channel, from 0 to 255.';
    hInput.title = 'Hue in degrees, from 0 to 360.';
    sInput.title = 'Saturation, from 0 (grey) to 1 (fully saturated).';
    lInput.title = 'Lightness, from 0 (black) to 1 (white).';
    const hexInput = document.createElement('input');
    hexInput.type = 'text';
    hexInput.value = '#000000';
    hexInput.title = 'Hexadecimal color code, for example #ff8800.';
    const preview = document.createElement('div');
    preview.className = 'color-preview';

    function updatePreview(): void {
      preview.style.background = `rgb(${current.r}, ${current.g}, ${current.b})`;
    }

    function syncRgb(): void {
      if (colorChanged) {
        return;
      }
      colorChanged = true;
      current = { r: Math.trunc(num(rInput)), g: Math.trunc(num(gInput)), b: Math.trunc(num(bInput)) };
      const hsl = colorToHsl(current);
      hInput.value = String(hsl.h);
      sInput.value = String(hsl.s);
      lInput.value = String(hsl.l);
      hexInput.value = colorToHex(current);
      updatePreview();
      colorChanged = false;
    }

    function syncHsl(): void {
      if (colorChanged) {
        return;
      }
      colorChanged = true;
      const h = num(hInput) % 360;
      const s = num(sInput);
      const l = num(lInput);
      current = hslToColor({ h, s, l });
      rInput.value = String(current.r);
      gInput.value = String(current.g);
      bInput.value = String(current.b);
      hexInput.value = colorToHex(current);
      updatePreview();
      colorChanged = false;
    }

    function syncHex(): void {
      if (colorChanged || !HEX_PATTERN.test(hexInput.value)) {
        return;
      }
      colorChanged = true;
      current = hexToColor(hexInput.value);
      rInput.value = String(current.r);
      gInput.value = String(current.g);
      bInput.value = String(current.b);
      const hsl = colorToHsl(current);
      hInput.value = String(hsl.h);
      sInput.value = String(hsl.s);
      lInput.value = String(hsl.l);
      updatePreview();
      colorChanged = false;
    }

    const pick = (color: RGB): void => {
      rInput.value = String(color.r);
      gInput.value = String(color.g);
      bInput.value = String(color.b);
      syncRgb();
    };

    rInput.addEventListener('input', syncRgb);
    gInput.addEventListener('input', syncRgb);
    bInput.addEventListener('input', syncRgb);
    hInput.addEventListener('input', syncHsl);
    sInput.addEventListener('input', syncHsl);
    lInput.addEventListener('input', syncHsl);
    hexInput.addEventListener('input', syncHex);
    hexInput.addEventListener('blur', syncHex);

    const dialog = createDialog(
      'Select Color - PixelPalette',
      420,
      'Ok',
      () => {
        if (activePicker === pick) {
          activePicker = null;
        }
      },
      false,
    );

    dialog.body.append(
      row('Color as RGB (0-255):', rInput, gInput, bInput),
      row('Color as HSL:', hInput, sInput, lInput),
      row('Hex code:', hexInput),
      row('', preview),
      h('div', { class: 'dialog-hint', text: 'Tip: click the image to pick its color.' }),
    );

    rInput.value = String(current.r);
    gInput.value = String(current.g);
    bInput.value = String(current.b);
    syncRgb();

    activePicker = pick;

    dialog.primary.addEventListener('click', () => resolve({ ...current }));
  });
}
