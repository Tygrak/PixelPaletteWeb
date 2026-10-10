import { colorToHex, hexToColor } from '../color';
import { AppContext } from '../context';
import { createDockPanel, DockPanel, h, row } from '../dom';
import type { CanvasBackdrop } from '../settings';

export function openSettingsPanel(ctx: AppContext, onClose?: () => void): DockPanel {
  const { store } = ctx;
  let unlisten: (() => void) | null = null;
  const panel = createDockPanel(ctx.dock, 'Settings', () => {
    unlisten?.();
    onClose?.();
  });

  const widthInput = document.createElement('input');
  widthInput.type = 'number';
  widthInput.min = '1';
  widthInput.style.width = '100px';
  widthInput.value = String(store.settings.canvasWidth);
  widthInput.addEventListener('change', () =>
    store.updateSettings({ canvasWidth: Math.max(1, Math.round(Number(widthInput.value) || 1)) }),
  );

  const heightInput = document.createElement('input');
  heightInput.type = 'number';
  heightInput.min = '1';
  heightInput.style.width = '100px';
  heightInput.value = String(store.settings.canvasHeight);
  heightInput.addEventListener('change', () =>
    store.updateSettings({ canvasHeight: Math.max(1, Math.round(Number(heightInput.value) || 1)) }),
  );

  const swatch = h('span', { class: 'palette-swatch small' });
  swatch.style.background = store.settings.backgroundColor;
  const pickButton = h('button', {
    class: 'btn',
    text: 'Pick Color',
    onclick: async () => {
      const chosen = await ctx.selectColor(hexToColor(store.settings.backgroundColor));
      store.updateSettings({ backgroundColor: colorToHex(chosen) });
    },
  });

  const animationCheckbox = document.createElement('input');
  animationCheckbox.type = 'checkbox';
  animationCheckbox.checked = store.settings.animationMode;
  animationCheckbox.addEventListener('change', () =>
    store.updateSettings({ animationMode: animationCheckbox.checked }),
  );

  const blankCheckbox = document.createElement('input');
  blankCheckbox.type = 'checkbox';
  blankCheckbox.checked = store.settings.blankNewImage;
  blankCheckbox.addEventListener('change', () =>
    store.updateSettings({ blankNewImage: blankCheckbox.checked }),
  );

  const backdropSelect = h('select', { class: 'select' }, [
    h('option', { value: 'checker', text: 'Checkerboard' }),
    h('option', { value: 'black', text: 'Pure black' }),
    h('option', { value: 'white', text: 'Pure white' }),
  ]);
  backdropSelect.value = store.settings.canvasBackdrop;
  backdropSelect.addEventListener('change', () =>
    store.updateSettings({ canvasBackdrop: backdropSelect.value as CanvasBackdrop }),
  );

  panel.body.append(
    h('div', { class: 'tab-content' }, [
      row('Default canvas width:', widthInput),
      row('Default canvas height:', heightInput),
      row('Default background:', swatch, pickButton),
      row('Blank (transparent) new image:', blankCheckbox),
      row('Image backdrop:', backdropSelect),
      row('Animation mode:', animationCheckbox),
      h('div', {
        class: 'dialog-hint',
        text: 'Animation mode shows a timeline at the bottom where you can add frames, reorder them and play the animation.',
      }),
      h('div', { class: 'dialog-hint', text: 'These settings are saved in your browser.' }),
    ]),
  );

  const sync = (): void => {
    if (document.activeElement !== widthInput) {
      widthInput.value = String(store.settings.canvasWidth);
    }
    if (document.activeElement !== heightInput) {
      heightInput.value = String(store.settings.canvasHeight);
    }
    swatch.style.background = store.settings.backgroundColor;
    animationCheckbox.checked = store.settings.animationMode;
    backdropSelect.value = store.settings.canvasBackdrop;
    blankCheckbox.checked = store.settings.blankNewImage;
    pickButton.disabled = store.settings.blankNewImage;
    swatch.style.opacity = store.settings.blankNewImage ? '0.4' : '1';
  };
  sync();
  unlisten = store.onChange(sync);

  return panel;
}
