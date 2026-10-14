import { colorToHex, hexToColor } from '../shared/color';
import { AppContext } from '../context';
import { createDockPanel, DockPanel, h, rowHint } from '../shared/dom';
import type { CanvasBackdrop } from '../core/settings';
import { createBrushSettingsSection } from './brushSettings';

export function openSettingsPanel(ctx: AppContext, onClose?: () => void): DockPanel {
    const { store } = ctx;
    let unlisten: (() => void) | null = null;
    const brushSettings = createBrushSettingsSection(store);
    const panel = createDockPanel(ctx.dock, 'Settings', () => {
        unlisten?.();
        brushSettings.dispose();
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

    const minimapCheckbox = document.createElement('input');
    minimapCheckbox.type = 'checkbox';
    minimapCheckbox.checked = store.settings.minimap;
    minimapCheckbox.addEventListener('change', () =>
        store.updateSettings({ minimap: minimapCheckbox.checked }),
    );

    const paletteSizeInput = document.createElement('input');
    paletteSizeInput.type = 'number';
    paletteSizeInput.min = '1';
    paletteSizeInput.max = '256';
    paletteSizeInput.style.width = '100px';
    paletteSizeInput.value = String(store.settings.paletteSize);
    paletteSizeInput.addEventListener('change', () =>
        store.updateSettings({ paletteSize: Math.max(1, Math.round(Number(paletteSizeInput.value) || 1)) }),
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
            rowHint('Default canvas width:', 'Width in pixels used for new files.', widthInput),
            rowHint('Default canvas height:', 'Height in pixels used for new files.', heightInput),
            rowHint(
                'Default background:',
                'Background color used for new files unless "Blank new image" is enabled.',
                swatch,
                pickButton,
            ),
            rowHint(
                'Blank (transparent) new image:',
                'Start new files fully transparent instead of filling them with the background color.',
                blankCheckbox,
            ),
            rowHint(
                'Default palette size:',
                'Number of colors generated from an image when it is imported. Images with fewer colors produce a smaller palette.',
                paletteSizeInput,
            ),
            rowHint('Image backdrop:', 'What is shown behind transparent pixels on the canvas.', backdropSelect),
            rowHint(
                'Minimap:',
                'Show a small overview of the image in the bottom-right corner; click or drag on it to pan while zoomed in.',
                minimapCheckbox,
            ),
            rowHint(
                'Animation mode:',
                'Show the timeline at the bottom to add frames, reorder them and play the animation.',
                animationCheckbox,
            ),
            brushSettings.root,
        ]),
    );

    const sync = (): void => {
        if (document.activeElement !== widthInput) {
            widthInput.value = String(store.settings.canvasWidth);
        }
        if (document.activeElement !== heightInput) {
            heightInput.value = String(store.settings.canvasHeight);
        }
        if (document.activeElement !== paletteSizeInput) {
            paletteSizeInput.value = String(store.settings.paletteSize);
        }
        swatch.style.background = store.settings.backgroundColor;
        animationCheckbox.checked = store.settings.animationMode;
        backdropSelect.value = store.settings.canvasBackdrop;
        blankCheckbox.checked = store.settings.blankNewImage;
        minimapCheckbox.checked = store.settings.minimap;
        pickButton.disabled = store.settings.blankNewImage;
        swatch.style.opacity = store.settings.blankNewImage ? '0.4' : '1';
    };
    sync();
    unlisten = store.onChange(sync);

    return panel;
}
