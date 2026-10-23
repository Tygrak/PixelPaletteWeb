// New File dialog: choose the size of a blank document and whether it opens in
// animation mode, or press Ctrl+V to start from an image in the clipboard.
// The size applies to this document only; the Settings defaults stay.

import { createDialog, h, num, numeric, row, rowHint } from '../shared/dom';
import { clipboardImageFile, imageDataFromBlob } from '../shared/files';
import type { Store } from '../core/store';

export type NewFileChoice =
    | { image: ImageData; animationMode: boolean }
    | { width: number; height: number; animationMode: boolean };

// Common canvas sizes offered as presets in the New File dialog. Pixel-art
// squares first, then a couple of standard screen resolutions.
const PRESETS: { label: string; width: number; height: number }[] = [
    { label: '16 × 16', width: 16, height: 16 },
    { label: '32 × 32', width: 32, height: 32 },
    { label: '64 × 64', width: 64, height: 64 },
    { label: '128 × 128', width: 128, height: 128 },
    { label: '256 × 256', width: 256, height: 256 },
    { label: '512 × 512', width: 512, height: 512 },
    { label: '1024 × 1024', width: 1024, height: 1024 },
    { label: '2048 × 2048', width: 2048, height: 2048 },
    { label: '1280 × 720', width: 1280, height: 720 },
    { label: '1920 × 1080', width: 1920, height: 1080 },
    { label: '2560 × 1440', width: 1920, height: 1080 },
];

export function openNewFileDialog(store: Store): Promise<NewFileChoice | null> {
    return new Promise((resolve) => {
        let done = false;
        const finish = (choice: NewFileChoice | null): void => {
            if (done) {
                return;
            }
            done = true;
            resolve(choice);
        };

        const widthInput = numeric(store.settings.canvasWidth, { min: 1, max: 100000, width: 110 });
        const heightInput = numeric(store.settings.canvasHeight, { min: 1, max: 100000, width: 110 });
        widthInput.title = 'Width of the new image in pixels (does not change the Settings default).';
        heightInput.title = 'Height of the new image in pixels (does not change the Settings default).';

        // Presets fill the size fields; editing them by hand switches the
        // dropdown to "Custom".
        const presetSelect = h('select', { class: 'select' });
        for (const [index, preset] of PRESETS.entries()) {
            presetSelect.append(h('option', { value: String(index), text: preset.label }));
        }
        presetSelect.append(h('option', { value: 'custom', text: 'Custom' }));
        presetSelect.title = 'Common image sizes; picking one fills in the width and height.';
        const syncPreset = (): void => {
            const width = Math.max(1, Math.round(num(widthInput)));
            const height = Math.max(1, Math.round(num(heightInput)));
            const index = PRESETS.findIndex((preset) => preset.width === width && preset.height === height);
            presetSelect.value = index >= 0 ? String(index) : 'custom';
        };
        presetSelect.addEventListener('change', () => {
            const preset = PRESETS[Number(presetSelect.value)];
            if (!preset) {
                return;
            }
            widthInput.value = String(preset.width);
            heightInput.value = String(preset.height);
        });
        widthInput.addEventListener('input', syncPreset);
        heightInput.addEventListener('input', syncPreset);
        syncPreset();

        const animationCheckbox = document.createElement('input');
        animationCheckbox.type = 'checkbox';
        animationCheckbox.checked = store.settings.animationMode;
        // Tooltip only (no visible note): the checkbox row explains itself.
        const animationHint = 'Open this file with the frame timeline shown. Can be changed later in Settings.';
        animationCheckbox.title = animationHint;

        const dialog = createDialog('New File', 380, 'Cancel', () => {
            window.removeEventListener('paste', onPaste, true);
            finish(null);
        });

        const createButton = h('button', {
            class: 'btn',
            text: 'New File',
            onclick: () => {
                finish({
                    width: Math.max(1, Math.round(num(widthInput))),
                    height: Math.max(1, Math.round(num(heightInput))),
                    animationMode: animationCheckbox.checked,
                });
                dialog.close();
            },
        });

        // Pasting while the dialog is open starts from the clipboard image instead
        // of adding it as a layer to the current document.
        const onPaste = (event: ClipboardEvent): void => {
            const file = clipboardImageFile(event);
            if (!file) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            void imageDataFromBlob(file).then((image) => {
                if (image) {
                    finish({ image, animationMode: animationCheckbox.checked });
                    dialog.close();
                }
            });
        };
        window.addEventListener('paste', onPaste, true);

        dialog.body.append(
            h('div', { class: 'tab-content' }, [
                rowHint('Preset:', 'Common image sizes; picking one fills in the width and height.', presetSelect),
                row('Width (px):', widthInput),
                row('Height (px):', heightInput),
                rowHint('Animation mode:', animationHint, animationCheckbox),
                h('div', { class: 'dialog-hint', text: 'Or press Ctrl+V to start from a clipboard image.' }),
            ]),
        );
        // "New File" sits next to Cancel.
        dialog.actions.prepend(createButton);
        widthInput.focus();
        widthInput.select();
    });
}
