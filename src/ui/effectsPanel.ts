import { colorToHex, rgb, RGB } from '../shared/color';
import { AppContext } from '../context';
import { button, colorSwatch, h, num, numeric, rowHint } from '../shared/dom';
import { detectEdges } from '../core/effects';

// Edge-detection controls, shown as a tab in the Adjustments panel (the former
// standalone Effects panel was merged into it).
export function createEdgeDetectionTab(ctx: AppContext): HTMLElement {
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

    return h('div', { class: 'tab-content' }, [
        rowHint('Edge width (px):', 'Thickness of the detected edge lines, in pixels.', widthInput),
        rowHint('Edge color:', 'Color used to draw the detected edges.', swatch, colorHex, pickColorButton),
        rowHint('Auto thresholds:', 'Choose the low and high thresholds automatically from the image.', autoCheckbox),
        rowHint('Low threshold:', 'Lower gradient threshold. Weaker edges below this are ignored.', lowInput),
        rowHint('High threshold:', 'Upper gradient threshold. Only stronger edges are kept.', highInput),
        rowHint('Background:', 'What to fill the non-edge areas with.', backgroundSelect),
        h('div', { class: 'button-row' }, [
            button('Detect Edges', async () => {
                if (!store.activeImage) {
                    return;
                }
                const image = store.activeImage;
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
}
