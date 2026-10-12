import { clamp, colorToHex, colorToHsl, hexToColor, hslToColor, RGB } from '../color';
import { createDialog, h, num, numeric, row } from '../dom';

const HEX_PATTERN = /^#?[0-9a-fA-F]{6}$/;

// Quick picker canvas sizes (content pixels; the CSS adds the border).
const PICKER_WIDTH = 150;
const PICKER_HEIGHT = 130;
const HUE_WIDTH = 20;

// The color picker is a non-modal floating panel. While it is open, the main
// canvas routes clicks here so the user can sample a color from the image.
let activePicker: ((color: RGB) => void) | null = null;

export function getActiveColorPicker(): ((color: RGB) => void) | null {
  return activePicker;
}

export function selectColorDialog(initial?: RGB, onChange?: (color: RGB) => void): Promise<RGB> {
  return new Promise<RGB>((resolve) => {
    const original: RGB = initial ? { ...initial } : { r: 0, g: 0, b: 0 };
    let current: RGB = { ...original };
    let colorChanged = false;
    let confirmed = false;

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

    // Quick picker: a saturation/lightness square for the current hue plus a
    // vertical hue strip. Click or drag either one to update the color.
    const pickerSquare = document.createElement('canvas');
    pickerSquare.className = 'picker-square';
    pickerSquare.width = PICKER_WIDTH;
    pickerSquare.height = PICKER_HEIGHT;
    pickerSquare.title = 'Click or drag to choose saturation and lightness.';
    const pickerHue = document.createElement('canvas');
    pickerHue.className = 'picker-hue';
    pickerHue.width = HUE_WIDTH;
    pickerHue.height = PICKER_HEIGHT;
    pickerHue.title = 'Click or drag to choose the hue.';
    const quickPicker = h('div', { class: 'quick-picker' }, [pickerSquare, pickerHue]);
    // The picker keeps its own hue so dragging through fully desaturated or
    // black/white colors does not reset the square to another hue.
    let hue = colorToHsl(original).h;
    let squareImage: ImageData | null = null;

    function updatePreview(): void {
      preview.style.background = `rgb(${current.r}, ${current.g}, ${current.b})`;
    }

    // Live pickers (onChange given) apply every change immediately, so the
    // color follows the picker even before it is closed.
    function notifyChange(): void {
      onChange?.({ ...current });
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
      refreshPicker();
      notifyChange();
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
      refreshPicker();
      notifyChange();
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
      refreshPicker();
      notifyChange();
    }

    const pick = (color: RGB): void => {
      rInput.value = String(color.r);
      gInput.value = String(color.g);
      bInput.value = String(color.b);
      syncRgb();
    };

    // Applies a color chosen in the quick picker: updates the color and every
    // input field, but leaves the picker's own hue state alone.
    function applyCurrentFromHsl(h: number, s: number, l: number): void {
      colorChanged = true;
      current = hslToColor({ h, s, l });
      rInput.value = String(current.r);
      gInput.value = String(current.g);
      bInput.value = String(current.b);
      hInput.value = String(h);
      sInput.value = String(s);
      lInput.value = String(l);
      hexInput.value = colorToHex(current);
      updatePreview();
      colorChanged = false;
      notifyChange();
    }

    // The square is cached and only refilled when the hue changes; while
    // dragging, just the marker is redrawn over it.
    function buildSquare(): void {
      const context = pickerSquare.getContext('2d');
      if (!context) {
        return;
      }
      const image = context.createImageData(PICKER_WIDTH, PICKER_HEIGHT);
      for (let y = 0; y < PICKER_HEIGHT; y++) {
        const lightness = 1 - y / (PICKER_HEIGHT - 1);
        for (let x = 0; x < PICKER_WIDTH; x++) {
          const color = hslToColor({ h: hue, s: x / (PICKER_WIDTH - 1), l: lightness });
          const index = (x + y * PICKER_WIDTH) * 4;
          image.data[index] = color.r;
          image.data[index + 1] = color.g;
          image.data[index + 2] = color.b;
          image.data[index + 3] = 255;
        }
      }
      squareImage = image;
    }

    function drawSquare(): void {
      const context = pickerSquare.getContext('2d');
      if (!context) {
        return;
      }
      if (!squareImage) {
        buildSquare();
      }
      context.putImageData(squareImage!, 0, 0);
      const hsl = colorToHsl(current);
      const x = clamp(hsl.s * (PICKER_WIDTH - 1), 6, PICKER_WIDTH - 6);
      const y = clamp((1 - hsl.l) * (PICKER_HEIGHT - 1), 6, PICKER_HEIGHT - 6);
      context.beginPath();
      context.arc(x, y, 5, 0, Math.PI * 2);
      context.strokeStyle = '#000';
      context.lineWidth = 3;
      context.stroke();
      context.strokeStyle = '#fff';
      context.lineWidth = 1;
      context.stroke();
    }

    function drawHue(): void {
      const context = pickerHue.getContext('2d');
      if (!context) {
        return;
      }
      const gradient = context.createLinearGradient(0, 0, 0, PICKER_HEIGHT);
      for (let i = 0; i <= 6; i++) {
        gradient.addColorStop(i / 6, colorToHex(hslToColor({ h: i * 60, s: 1, l: 0.5 })));
      }
      context.fillStyle = gradient;
      context.fillRect(0, 0, HUE_WIDTH, PICKER_HEIGHT);
      const y = (hue / 360) * (PICKER_HEIGHT - 1);
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(HUE_WIDTH, y);
      context.strokeStyle = '#000';
      context.lineWidth = 3;
      context.stroke();
      context.strokeStyle = '#fff';
      context.lineWidth = 1;
      context.stroke();
    }

    // Follows a color change made anywhere else (inputs, hex field, image
    // sampling) by re-centering the picker on the new color.
    function refreshPicker(): void {
      hue = colorToHsl(current).h;
      buildSquare();
      drawSquare();
      drawHue();
    }

    function canvasFraction(canvas: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } {
      const rect = canvas.getBoundingClientRect();
      return {
        x: clamp((clientX - rect.left - canvas.clientLeft) / canvas.clientWidth, 0, 1),
        y: clamp((clientY - rect.top - canvas.clientTop) / canvas.clientHeight, 0, 1),
      };
    }

    function pickFromSquare(event: PointerEvent): void {
      const point = canvasFraction(pickerSquare, event.clientX, event.clientY);
      applyCurrentFromHsl(hue, point.x, 1 - point.y);
      drawSquare();
    }

    function pickFromHue(event: PointerEvent): void {
      const point = canvasFraction(pickerHue, event.clientX, event.clientY);
      hue = point.y * 360;
      const hsl = colorToHsl(current);
      applyCurrentFromHsl(hue, hsl.s, hsl.l);
      buildSquare();
      drawSquare();
      drawHue();
    }

    function wirePicker(canvas: HTMLCanvasElement, pickColor: (event: PointerEvent) => void): void {
      canvas.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        canvas.setPointerCapture(event.pointerId);
        pickColor(event);
      });
      canvas.addEventListener('pointermove', (event) => {
        if (canvas.hasPointerCapture(event.pointerId)) {
          pickColor(event);
        }
      });
      canvas.addEventListener('pointerup', (event) => {
        if (canvas.hasPointerCapture(event.pointerId)) {
          canvas.releasePointerCapture(event.pointerId);
        }
      });
    }
    wirePicker(pickerSquare, pickFromSquare);
    wirePicker(pickerHue, pickFromHue);

    rInput.addEventListener('input', syncRgb);
    gInput.addEventListener('input', syncRgb);
    bInput.addEventListener('input', syncRgb);
    hInput.addEventListener('input', syncHsl);
    sInput.addEventListener('input', syncHsl);
    lInput.addEventListener('input', syncHsl);
    hexInput.addEventListener('input', syncHex);
    hexInput.addEventListener('blur', syncHex);

    const dialog = createDialog(
      'Select Color',
      420,
      'Ok',
      () => {
        if (activePicker === pick) {
          activePicker = null;
        }
        // Ok confirms the edited color; dismissing (Escape or ✕) keeps the
        // original color for regular pickers. Live pickers have no cancel, so
        // what was already applied stays when they are dismissed.
        resolve(confirmed || onChange ? { ...current } : { ...original });
      },
      false,
    );

    // Browsers may run microtasks between two listeners of the same click, so
    // the Ok state has to be recorded before the primary button's own close
    // handler (registered first) runs. A capture listener on the parent runs
    // before any listener on the button itself.
    dialog.actions.addEventListener(
      'click',
      (event) => {
        if (event.target === dialog.primary) {
          confirmed = true;
        }
      },
      true,
    );

    dialog.body.append(
      row('Color as RGB (0-255):', rInput, gInput, bInput),
      row('Color as HSL:', hInput, sInput, lInput),
      row('Hex code:', hexInput),
      row('', quickPicker, preview),
      h('div', { class: 'dialog-hint', text: 'Tip: click the image to pick its color.' }),
    );

    rInput.value = String(current.r);
    gInput.value = String(current.g);
    bInput.value = String(current.b);
    syncRgb();

    activePicker = pick;
  });
}
