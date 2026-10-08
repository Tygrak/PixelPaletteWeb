import { colorToHex, rgb, RGB } from '../color';
import { AppContext } from '../context';
import {
  button,
  colorSwatch,
  createDockPanel,
  createTabs,
  DockPanel,
  h,
  num,
  numeric,
  row,
} from '../dom';
import { detectEdges } from '../effects';

export function openEffectsPanel(ctx: AppContext, onClose?: () => void): DockPanel {
  const panel = createDockPanel(ctx.dock, 'Effects', onClose);
  const { store } = ctx;

  let edgeColor: RGB = rgb(255, 255, 255);
  const swatch = colorSwatch(edgeColor, 'palette-swatch');
  const colorHex = h('span', { class: 'row-value', text: colorToHex(edgeColor) });

  const widthInput = numeric(1, { min: 1, max: 10, step: 1, width: 120 });
  const lowInput = numeric(30, { min: 0, max: 255, width: 120 });
  const highInput = numeric(80, { min: 0, max: 255, width: 120 });

  const autoCheckbox = document.createElement('input');
  autoCheckbox.type = 'checkbox';
  autoCheckbox.checked = true;
  lowInput.disabled = true;
  highInput.disabled = true;
  autoCheckbox.addEventListener('change', () => {
    lowInput.disabled = autoCheckbox.checked;
    highInput.disabled = autoCheckbox.checked;
  });

  const backgroundSelect = h('select', { class: 'select' });
  backgroundSelect.append(
    h('option', { value: 'black', text: 'Black' }),
    h('option', { value: 'white', text: 'White' }),
    h('option', { value: 'original', text: 'Original image' }),
  );
  backgroundSelect.value = 'original';

  const getBackground = (): RGB | null => {
    if (backgroundSelect.value === 'original') {
      return null;
    }
    return backgroundSelect.value === 'white' ? rgb(255, 255, 255) : rgb(0, 0, 0);
  };

  const pickColorButton = button('Pick Color', async () => {
    edgeColor = await ctx.selectColor(edgeColor);
    swatch.style.background = `rgb(${edgeColor.r}, ${edgeColor.g}, ${edgeColor.b})`;
    colorHex.textContent = colorToHex(edgeColor);
  });

  const edgeTab = h('div', { class: 'tab-content' }, [
    row('Edge width (px):', widthInput),
    row('Edge color:', swatch, colorHex, pickColorButton),
    row('Auto thresholds:', autoCheckbox),
    row('Low threshold:', lowInput),
    row('High threshold:', highInput),
    row('Background:', backgroundSelect),
    h('div', { class: 'button-row' }, [
      button('Detect Edges', async () => {
        if (!store.current) {
          return;
        }
        const image = store.current;
        const auto = autoCheckbox.checked;
        const options = {
          width: num(widthInput),
          lowThreshold: num(lowInput),
          highThreshold: num(highInput),
          edgeColor: { ...edgeColor },
          background: getBackground(),
          autoThresholds: auto,
        };
        const result = await ctx.runTask('Detecting edges', () => detectEdges(image, options));
        if (auto) {
          lowInput.value = String(result.lowThreshold);
          highInput.value = String(result.highThreshold);
        }
        ctx.applyImage(result.image);
      }),
    ]),
  ]);

  panel.body.append(createTabs([{ label: 'Edge Detection', content: edgeTab }]));

  return panel;
}
