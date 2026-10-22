import { blurImage, grayscaleImage, invertImage, shiftHsl } from '../core/adjust';
import { withDropShadow } from '../core/shadow';
import { AppContext } from '../context';
import { colorToHex, rgb, RGB } from '../shared/color';
import { button, colorSwatch, createDockPanel, createTabs, DockPanel, h, num, numeric, rowHint } from '../shared/dom';
import { calculateAverageBrightnessError, calculateAverageError, flipImage, rotateImage } from '../shared/image';
import { createEdgeDetectionTab } from './effectsPanel';

export function openAdjustmentsPanel(ctx: AppContext, onClose?: () => void): DockPanel {
    const { store } = ctx;
    const panel = createDockPanel(ctx.dock, 'Adjustments', () => {
        onClose?.();
    });

    const apply = async (status: string, task: () => ImageData): Promise<void> => {
        if (!store.activeImage) {
            return;
        }
        const result = await ctx.runTask(status, task);
        ctx.applyImage(result);
    };

    // --- Common (color adjustments + rotate/flip; resizing has its own tool) ---
    const commonTab = h('div', { class: 'tab-content' }, [
        h('div', { class: 'button-row' }, [
            button(
                'Invert Colors',
                () => apply('Inverting colors', () => invertImage(store.activeImage!)),
                'Invert every color channel; transparent pixels stay transparent.',
            ),
        ]),
        h('div', { class: 'button-row' }, [
            button(
                'Grayscale',
                () => apply('Converting to grayscale', () => grayscaleImage(store.activeImage!)),
                'Replace every color with its grayscale luminance.',
            ),
        ]),
        h('div', { class: 'divider' }),
        h('div', { class: 'row' }, [
            h('span', { class: 'row-label', text: 'Rotate:' }),
            h('div', { class: 'row-controls' }, [
                button('90° Clockwise', () => apply('Rotating image', () => rotateImage(store.activeImage!, 90))),
                button('90° Counterclockwise', () => apply('Rotating image', () => rotateImage(store.activeImage!, 270))),
            ]),
        ]),
        h('div', { class: 'row' }, [
            h('span', { class: 'row-label', text: 'Flip:' }),
            h('div', { class: 'row-controls' }, [
                button('X Axis', () => apply('Flipping image', () => flipImage(store.activeImage!, 'x'))),
                button('Y Axis', () => apply('Flipping image', () => flipImage(store.activeImage!, 'y'))),
            ]),
        ]),
        h('div', { class: 'panel-hint', text: 'To change the image size, use the Resize Image tool (R).' }),
    ]);

    // --- HSL shift ---
    const hueInput = numeric(0, { width: 200 });
    const saturationInput = numeric(0, { width: 200 });
    const lightnessInput = numeric(0, { width: 200 });
    const hslTab = h('div', { class: 'tab-content' }, [
        rowHint('Hue shift (° change):', 'Degrees to rotate every hue around the color wheel.', hueInput),
        rowHint('Saturation (% change):', 'Percentage to increase or decrease color saturation.', saturationInput),
        rowHint('Lightness (% change):', 'Percentage to increase or decrease brightness.', lightnessInput),
        h('div', { class: 'button-row' }, [
            button('Shift HSL', () =>
                apply('Adjusting image', () =>
                    shiftHsl(store.activeImage!, num(hueInput), num(saturationInput) / 100, num(lightnessInput) / 100),
                ),
            ),
        ]),
    ]);

    // --- Blur ---
    const blurSigma = numeric(2, { width: 200 });
    const blurTab = h('div', { class: 'tab-content' }, [
        rowHint('Amount (σ):', 'Gaussian blur strength. Larger values blur the image more.', blurSigma),
        h('div', { class: 'button-row' }, [
            button('Blur', () => apply('Blurring image', () => blurImage(store.activeImage!, num(blurSigma)))),
        ]),
    ]);

    // --- Drop shadow ---
    let shadowColor: RGB = rgb(0, 0, 0);
    const shadowSwatch = colorSwatch(shadowColor, 'palette-swatch');
    const shadowHex = h('span', { class: 'row-value', text: colorToHex(shadowColor) });
    const shadowXInput = numeric(4, { min: -250, max: 250, step: 1, width: 120 });
    const shadowYInput = numeric(4, { min: -250, max: 250, step: 1, width: 120 });
    const shadowBlurInput = numeric(4, { min: 0, max: 50, step: 1, width: 120 });
    const shadowOpacityInput = numeric(100, { min: 0, max: 100, step: 1, width: 120 });
    const shadowSweepCheckbox = document.createElement('input');
    shadowSweepCheckbox.type = 'checkbox';
    shadowSweepCheckbox.checked = true;
    const shadowTab = h('div', { class: 'tab-content' }, [
        rowHint('Offset X (px):', 'How far the shadow falls to the right (negative = left).', shadowXInput),
        rowHint('Offset Y (px):', 'How far the shadow falls down (negative = up).', shadowYInput),
        rowHint('Softness (px):', 'Blurs the shadow edge so it fades out instead of ending hard.', shadowBlurInput),
        rowHint('Opacity (%):', 'Strength of the shadow.', shadowOpacityInput),
        rowHint(
            'Connect to layer:',
            'Sweeps the shadow from the layer edge all the way to the offset, so there is no gap between them.',
            shadowSweepCheckbox,
        ),
        rowHint(
            'Shadow color:',
            'Color of the cast shadow.',
            shadowSwatch,
            shadowHex,
            button('Pick Color', async () => {
                shadowColor = await ctx.selectColor(shadowColor);
                shadowSwatch.style.background = `rgb(${shadowColor.r}, ${shadowColor.g}, ${shadowColor.b})`;
                shadowHex.textContent = colorToHex(shadowColor);
            }),
        ),
        h('div', { class: 'button-row' }, [
            button(
                'Apply Drop Shadow',
                () =>
                    apply('Adding drop shadow', () =>
                        withDropShadow(store.activeImage!, {
                            color: shadowColor,
                            offsetX: num(shadowXInput),
                            offsetY: num(shadowYInput),
                            blur: num(shadowBlurInput),
                            opacity: num(shadowOpacityInput) / 100,
                            sweep: shadowSweepCheckbox.checked,
                        }),
                    ),
                "Casts a shadow behind the active layer's non-transparent pixels.",
            ),
        ]),
    ]);

    // --- Compare ---
    const errorText = h('span', { class: 'row-value' });
    const brightnessText = h('span', { class: 'row-value' });

    const compareImages = async (a: ImageData | null, b: ImageData | null): Promise<void> => {
        if (!a || !b || a.width !== b.width || a.height !== b.height) {
            return;
        }
        panel.status.textContent = 'Comparing images';
        await new Promise((resolve) => setTimeout(resolve, 0));
        const error = calculateAverageError(a, b);
        const brightnessError = calculateAverageBrightnessError(a, b);
        errorText.textContent = String(error);
        brightnessText.textContent = `${(brightnessError * 100).toFixed(5)}%`;
        panel.status.textContent = '';
    };

    const compareTab = h('div', { class: 'tab-content' }, [
        h('div', { class: 'row' }, [
            h('span', { class: 'row-label', text: 'Result average distance error:' }),
            h('div', { class: 'row-controls' }, [errorText]),
        ]),
        h('div', { class: 'row' }, [
            h('span', { class: 'row-label', text: 'Result average brightness error:' }),
            h('div', { class: 'row-controls' }, [brightnessText]),
        ]),
        h('div', { class: 'button-row' }, [
            button('Compare With Initial Image', () => compareImages(store.current, store.initial)),
        ]),
        h('div', { class: 'button-row' }, [
            button('Compare With Image From File', async () => {
                const image = await ctx.openImageFile();
                if (image) {
                    await compareImages(store.current, image);
                }
            }),
        ]),
    ]);

    panel.body.append(
        createTabs([
            { label: 'Common', content: commonTab },
            { label: 'HSL shift', content: hslTab },
            { label: 'Blur', content: blurTab },
            { label: 'Drop Shadow', content: shadowTab },
            { label: 'Edge Detection', content: createEdgeDetectionTab(ctx) },
            { label: 'Compare', content: compareTab },
        ]),
    );

    return panel;
}
