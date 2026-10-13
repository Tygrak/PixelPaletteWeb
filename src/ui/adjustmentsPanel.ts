import { blurImage, shiftHsl } from '../core/adjust';
import { AppContext } from '../context';
import { button, createDockPanel, createTabs, DockPanel, h, num, numeric, rowHint } from '../shared/dom';
import { calculateAverageBrightnessError, calculateAverageError, flipImage, resizeImage, rotateImage } from '../shared/image';

export function openAdjustmentsPanel(ctx: AppContext, onClose?: () => void): DockPanel {
    const { store } = ctx;
    let unlisten: (() => void) | null = null;
    const panel = createDockPanel(ctx.dock, 'Adjustments', () => {
        unlisten?.();
        onClose?.();
    });

    const apply = async (status: string, task: () => ImageData): Promise<void> => {
        if (!store.activeImage) {
            return;
        }
        const result = await ctx.runTask(status, task);
        ctx.applyImage(result);
    };

    // --- Transform ---
    const widthInput = numeric(512, { min: 1, width: 200 });
    const heightInput = numeric(512, { min: 1, width: 200 });
    const lockRatio = document.createElement('input');
    lockRatio.type = 'checkbox';
    lockRatio.checked = true;
    let ratio = num(widthInput) / num(heightInput);

    const updateRatio = (): void => {
        const height = num(heightInput) || 1;
        ratio = num(widthInput) / height;
    };
    widthInput.addEventListener('input', () => {
        if (lockRatio.checked) {
            heightInput.value = String(Math.round(num(widthInput) / ratio));
        }
    });
    heightInput.addEventListener('input', () => {
        if (lockRatio.checked) {
            widthInput.value = String(Math.round(num(heightInput) * ratio));
        }
    });
    lockRatio.addEventListener('click', updateRatio);

    const transformTab = h('div', { class: 'tab-content' }, [
        rowHint('New width:', 'Target width of the resized image, in pixels.', widthInput),
        rowHint('New height:', 'Target height of the resized image, in pixels.', heightInput),
        rowHint('Lock Ratio:', 'Keep the current width-to-height ratio while resizing.', lockRatio),
        h('div', { class: 'button-row' }, [
            button('Resize', async () => {
                const width = Math.max(1, Math.trunc(num(widthInput)));
                const height = Math.max(1, Math.trunc(num(heightInput)));
                await apply('Resizing image', () => resizeImage(store.activeImage!, width, height));
            }),
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
            { label: 'Transform', content: transformTab },
            { label: 'HSL shift', content: hslTab },
            { label: 'Blur', content: blurTab },
            { label: 'Compare', content: compareTab },
        ]),
    );

    // Keep resize fields in sync with the current image while the dialog is open.
    let lastImage: ImageData | null = null;
    const sync = (): void => {
        if (store.activeImage && store.activeImage !== lastImage) {
            lastImage = store.activeImage;
            if (lockRatio.checked) {
                widthInput.value = String(store.activeImage.width);
                heightInput.value = String(store.activeImage.height);
                updateRatio();
            }
        }
    };
    unlisten = store.onChange(sync);
    sync();

    return panel;
}
