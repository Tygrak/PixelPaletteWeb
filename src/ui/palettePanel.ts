import { colorToHex, colorToHsl, distinctColors, hexToColor, hslToColor, RGB } from '../color';
import { AppContext } from '../context';
import { button, colorSwatch, createDockPanel, createTabs, DockPanel, h, num, numeric, rowHint } from '../dom';
import { loadTextFile, saveTextFile } from '../files';
import { fakeDuoTone, kMeans, medianCut, sectorsHighMidLow, sortColors } from '../palette';

export function openPalettePanel(ctx: AppContext, onClose?: () => void): DockPanel {
  const panel = createDockPanel(ctx.dock, 'Palette', onClose);
  const { store } = ctx;

  // --- Palette Colors tab ---
  let selectedIndex = -1;
  const list = h('div', { class: 'palette-list' });
  let lastListSignature = '';
  const listItems: HTMLElement[] = [];

  const renderList = (): void => {
    const signature = store.palette.map((color) => colorToHex(color)).join(',');
    if (signature !== lastListSignature) {
      lastListSignature = signature;
      list.replaceChildren();
      listItems.length = 0;
      store.palette.forEach((color, index) => {
        const item = h('div', { class: 'palette-item' }, [
          h('span', { class: 'palette-hex', text: colorToHex(color) }),
          colorSwatch(color, 'palette-swatch'),
        ]);
        item.addEventListener('click', () => {
          selectedIndex = index;
          renderList();
        });
        item.addEventListener('dblclick', async () => {
          const wasActive = colorToHex(store.foreground) === colorToHex(store.palette[index]);
          const result = await ctx.selectColor(store.palette[index]);
          store.palette[index] = result;
          // Editing the color that is currently in use also applies it as the
          // current brush/text color.
          if (wasActive) {
            store.setForeground(result);
          }
          selectedIndex = index;
          renderList();
        });
        list.append(item);
        listItems.push(item);
      });
    }
    // Update the selection in place: rebuilding the items on every click would
    // destroy the element between the two clicks of a double click.
    listItems.forEach((item, index) => {
      item.classList.toggle('selected', index === selectedIndex);
    });
    store.emit();
  };
  renderList();

  const colorsTab = h('div', { class: 'tab-content' }, [
    h('div', { class: 'fill' }, [list]),
    h('div', { class: 'button-row' }, [
      button('Clear Palette', () => {
        store.palette = [];
        selectedIndex = -1;
        renderList();
      }),
      button('Remove Color', () => {
        if (selectedIndex >= 0 && selectedIndex < store.palette.length) {
          store.palette.splice(selectedIndex, 1);
          selectedIndex = -1;
          renderList();
        }
      }),
      button('Add Color', async () => {
        const result = await ctx.selectColor();
        store.palette.push(result);
        renderList();
      }),
    ]),
  ]);

  // --- Median Cut tab ---
  const medianCutAmount = numeric(8, { min: 2, width: 200 });
  const medianCutTab = h('div', { class: 'tab-content' }, [
    rowHint('Result color amount:', 'Number of colors the palette is reduced to.', medianCutAmount),
    h('div', { class: 'button-row' }, [
      button('Preview Median Cut', async () => {
        if (!store.activeImage) {
          return;
        }
        const amount = Math.trunc(num(medianCutAmount));
        const image = store.activeImage;
        const result = await ctx.runTask('Sorting image', () => sortColors(image, amount));
        ctx.applyImage(result);
      }),
      button('Generate Median Cut Palette', async () => {
        if (!store.activeImage) {
          return;
        }
        const amount = Math.trunc(num(medianCutAmount));
        const image = store.activeImage;
        store.palette = await ctx.runTask('Generating palette', () => medianCut(image, amount));
        selectedIndex = -1;
        renderList();
      }),
    ]),
  ]);

  // --- K-Means tab ---
  const kMeansAmount = numeric(8, { min: 2, width: 200 });
  const kMeansSteps = numeric(10, { min: 1, width: 200 });
  const kMeansTab = h('div', { class: 'tab-content' }, [
    rowHint('Result color amount:', 'Number of colors to cluster the image into.', kMeansAmount),
    rowHint('Max steps:', 'Maximum number of refinement iterations for the clustering.', kMeansSteps),
    h('div', { class: 'button-row' }, [
      button('Generate K-Means Clustering Palette', async () => {
        if (!store.activeImage) {
          return;
        }
        const amount = Math.trunc(num(kMeansAmount));
        const steps = Math.trunc(num(kMeansSteps));
        const image = store.activeImage;
        store.palette = await ctx.runTask('Generating palette', () => kMeans(image, amount, steps));
        selectedIndex = -1;
        renderList();
      }),
    ]),
  ]);

  // --- HML tab ---
  const hmlAmount = numeric(8, { min: 2, width: 200 });
  const hmlTab = h('div', { class: 'tab-content' }, [
    rowHint('Result color amount:', 'Number of colors generated from the hue sectors.', hmlAmount),
    h('div', { class: 'button-row' }, [
      button('Generate Sectors High Mid Low Palette', async () => {
        if (!store.activeImage) {
          return;
        }
        const amount = Math.trunc(num(hmlAmount));
        const image = store.activeImage;
        store.palette = await ctx.runTask('Generating palette', () => sectorsHighMidLow(image, amount));
        selectedIndex = -1;
        renderList();
      }),
    ]),
  ]);

  // --- Duo Tone tab ---
  const duoToneAmount = numeric(16, { min: 2, width: 200 });
  const duoToneHue = numeric(0, { min: 0, max: 360, width: 200 });
  const duoToneSaturation = numeric(0.5, { min: 0, max: 1, step: 0.01, width: 200 });
  const duoToneTab = h('div', { class: 'tab-content' }, [
    rowHint('Result color amount:', 'Number of shades generated between the two tones.', duoToneAmount),
    rowHint('Color hue (HSL):', 'Hue of the color the palette blends toward (0-360).', duoToneHue),
    rowHint('Color saturation (HSL):', 'Saturation of the color the palette blends toward (0-1).', duoToneSaturation),
    h('div', { class: 'button-row' }, [
      button('Pick Color', async () => {
        const current = hslToColor({ h: num(duoToneHue), s: num(duoToneSaturation), l: 0.5 });
        const result = await ctx.selectColor(current);
        const hsl = colorToHsl(result);
        duoToneHue.value = String(hsl.h);
        duoToneSaturation.value = String(hsl.s);
      }),
    ]),
    h('div', { class: 'button-row' }, [
      button('Generate Duo Tone Palette', async () => {
        const amount = Math.trunc(num(duoToneAmount));
        const hue = num(duoToneHue) % 360;
        const saturation = num(duoToneSaturation);
        store.palette = await ctx.runTask('Generating palette', () => fakeDuoTone(amount, hue, saturation));
        selectedIndex = -1;
        renderList();
      }),
      button('Add Duo Tone To Current Palette', async () => {
        const amount = Math.trunc(num(duoToneAmount));
        const hue = num(duoToneHue) % 360;
        const saturation = num(duoToneSaturation);
        const generated = await ctx.runTask('Generating palette', () => fakeDuoTone(amount, hue, saturation));
        store.palette = distinctColors([...store.palette, ...generated]);
        selectedIndex = -1;
        renderList();
      }),
    ]),
  ]);

  // --- Import / Export tab ---
  const separatorInput = document.createElement('input');
  separatorInput.type = 'text';
  separatorInput.value = '\\n';
  separatorInput.style.width = '200px';
  const getSeparator = (): string => separatorInput.value.replace(/\\n/g, '\n');

  const importExportTab = h('div', { class: 'tab-content' }, [
    rowHint('Color separator:', 'Text placed between colors when importing or exporting a palette.', separatorInput),
    h('div', { class: 'button-row' }, [
      button('Import Palette', async () => {
        const file = await loadTextFile();
        if (!file) {
          return;
        }
        const separator = getSeparator();
        const colors: RGB[] = file.text
          .split(separator)
          .filter((part) => part.trim() !== '')
          .map((part) => hexToColor(part));
        store.palette = distinctColors(colors);
        selectedIndex = -1;
        renderList();
      }),
      button('Export Palette', () => {
        const separator = getSeparator();
        const text = store.palette.map((color) => colorToHex(color)).join(separator);
        saveTextFile(text, 'palette.palette');
      }),
    ]),
  ]);

  panel.body.append(
    createTabs([
      { label: 'Palette Colors', content: colorsTab },
      { label: 'Median Cut', content: medianCutTab },
      { label: 'K-Means', content: kMeansTab },
      { label: 'HML', content: hmlTab },
      { label: 'Duo Tone', content: duoToneTab },
      { label: 'Import/Export', content: importExportTab },
    ]),
  );

  return panel;
}
