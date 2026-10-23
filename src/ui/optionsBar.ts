import { store } from '../appStore';
import { allBrushes, onBrushesChanged } from '../core/brushLibrary';
import { DEFAULT_BRUSH_ID } from '../core/brushes';
import { fitToView, zoomLabel, zoomToScale } from '../editor/canvasView';
import { clamp, colorToHex } from '../shared/color';
import { AppContext } from '../context';
import { h } from '../shared/dom';
import { commitFloating } from '../editor/floatingSelection';
import { isBrushTool } from '../editor/paint';

// Options bar under the toolbar: per-tool controls (brush, knife, bucket,
// wand, zoom, resize, text) plus the palette strip. Only the sections for the
// active tool are shown; refresh() syncs every control with the store.

export interface OptionsBar {
    element: HTMLElement;
    resizeWidthInput: HTMLInputElement;
    resizeHeightInput: HTMLInputElement;
    resizeScaleCheckbox: HTMLInputElement;
    refresh(): void;
}

export function createOptionsBar(ctx: AppContext): OptionsBar {
    function numberInput(value: number, min: number, max: number, step: number, onInput: () => void): HTMLInputElement {
        const input = h('input', { type: 'number', value: String(value) });
        input.min = String(min);
        input.max = String(max);
        input.step = String(step);
        input.style.width = '80px';
        input.addEventListener('input', onInput);
        return input;
    }

    function readNumber(input: HTMLInputElement): number {
        const value = parseFloat(input.value);
        return Number.isNaN(value) ? 0 : value;
    }

    const brushSizeInput = numberInput(store.activeBrushSize, 1, 500, 1, () =>
        store.setActiveBrushSize(readNumber(brushSizeInput)),
    );
    brushSizeInput.title = 'Brush size in pixels.';
    const brushOpacityInput = numberInput(Math.round(store.brushOpacity * 100), 0, 100, 1, () =>
        store.setBrushOpacity(clamp(readNumber(brushOpacityInput) / 100, 0, 1)),
    );
    brushOpacityInput.title = 'Brush opacity, from 0 to 100%.';
    const brushSwatch = h('span', { class: 'palette-swatch small' });
    const pickForegroundButton = h('button', {
        class: 'btn',
        text: 'Color',
        title: 'Pick the paint color; changes apply to the brush immediately.',
        onclick: async () => {
            // Live picker: every change (typing or sampling from the image) updates
            // the brush color right away.
            const chosen = await ctx.selectColor(store.foreground, (color) => store.setForeground(color));
            store.setForeground(chosen);
        },
    });
    // Brush pickers list the brush library (defaults plus user edits and custom
    // brushes); they are rebuilt whenever the library changes in the settings.
    function fillBrushSelect(select: HTMLSelectElement): void {
        select.replaceChildren(...allBrushes().map((brush) => h('option', { value: brush.id, text: brush.label })));
        select.value = store.brushId;
    }
    function createBrushSelect(): HTMLSelectElement {
        const select = h('select', { class: 'select' });
        select.title = 'Brush tip shape and texture.';
        select.addEventListener('change', () => store.setBrush(select.value));
        fillBrushSelect(select);
        return select;
    }
    const brushSelect = createBrushSelect();
    const brushSection = h('div', { class: 'options-section' }, [
        h('span', { class: 'row-label', text: 'Brush' }),
        brushSelect,
        h('span', { class: 'row-label', text: 'Size' }),
        brushSizeInput,
        h('span', { class: 'row-label', text: 'Opacity' }),
        brushOpacityInput,
        h('span', { class: 'row-label', text: 'Color' }),
        brushSwatch,
        pickForegroundButton,
    ]);

    // Palette knife controls edit the same size/opacity state as the brush, but
    // live in their own inputs so they can be shown independently.
    const knifeSizeInput = numberInput(store.brushSize, 1, 500, 1, () => store.setBrushSize(readNumber(knifeSizeInput)));
    knifeSizeInput.title = 'Knife size in pixels.';
    const knifeStrengthInput = numberInput(Math.round(store.brushOpacity * 100), 0, 100, 1, () =>
        store.setBrushOpacity(clamp(readNumber(knifeStrengthInput) / 100, 0, 1)),
    );
    knifeStrengthInput.title = 'How strongly the knife lays the picked-up paint back down.';
    const knifeSmearInput = numberInput(Math.round(store.knifeSmear * 100), 0, 100, 1, () =>
        store.setKnifeSmear(clamp(readNumber(knifeSmearInput) / 100, 0, 1)),
    );
    knifeSmearInput.title = 'How far behind the cursor the knife samples paint to smear along the stroke.';
    const knifeSelect = createBrushSelect();
    const knifeSection = h('div', { class: 'options-section' }, [
        h('span', { class: 'row-label', text: 'Brush' }),
        knifeSelect,
        h('span', { class: 'row-label', text: 'Size' }),
        knifeSizeInput,
        h('span', { class: 'row-label', text: 'Strength' }),
        knifeStrengthInput,
        h('span', { class: 'row-label', text: 'Smear' }),
        knifeSmearInput,
    ]);
    onBrushesChanged(() => {
        // A custom brush that was deleted may still be the active one; fall back to Round.
        if (!allBrushes().some((brush) => brush.id === store.brushId)) {
            store.setBrush(DEFAULT_BRUSH_ID);
        }
        fillBrushSelect(brushSelect);
        fillBrushSelect(knifeSelect);
    });

    const wandToleranceInput = numberInput(store.wandTolerance, 0, 255, 1, () =>
        store.setWandTolerance(readNumber(wandToleranceInput)),
    );
    wandToleranceInput.title = 'How different a color can be and still be selected by the magic wand.';
    const wandSection = h('div', { class: 'options-section' }, [
        h('span', { class: 'row-label', text: 'Tolerance' }),
        wandToleranceInput,
    ]);

    const fillToleranceInput = numberInput(store.fillTolerance, 0, 255, 1, () =>
        store.setFillTolerance(readNumber(fillToleranceInput)),
    );
    fillToleranceInput.title = 'How different a color can be and still be filled by the paint bucket.';
    const bucketSection = h('div', { class: 'options-section' }, [
        h('span', { class: 'row-label', text: 'Tolerance' }),
        fillToleranceInput,
    ]);

    const paletteStrip = h('div', { class: 'palette-strip' });
    let lastPaletteSignature = '';
    const paletteDots: HTMLButtonElement[] = [];

    function paletteKeyHint(index: number): string {
        // The first ten entries are reachable with the number row (1-9, then 0).
        return index < 9 ? String(index + 1) : index === 9 ? '0' : '';
    }

    function renderPaletteStrip(): void {
        const foregroundHex = colorToHex(store.foreground);
        const paletteSignature = store.palette.map((color) => colorToHex(color)).join(',');
        if (paletteSignature !== lastPaletteSignature) {
            lastPaletteSignature = paletteSignature;
            paletteStrip.replaceChildren();
            paletteDots.length = 0;
            store.palette.forEach((color, index) => {
                const dot = h('button', {
                    class: 'palette-dot',
                    onclick: () => store.setForeground(color),
                });
                // Double click edits this palette entry in the color picker. When it is
                // the selected (active) swatch, the edited color also becomes the
                // current brush/text color.
                dot.addEventListener('dblclick', async () => {
                    const wasActive = colorToHex(store.foreground) === colorToHex(store.palette[index]);
                    const chosen = await ctx.selectColor(store.palette[index]);
                    store.setPaletteColor(index, chosen);
                    if (wasActive) {
                        store.setForeground(chosen);
                    }
                });
                paletteStrip.append(dot);
                paletteDots.push(dot);
            });
        }
        // Update the dots in place. Rebuilding them on every foreground change would
        // destroy the element between the two clicks of a double click, which makes
        // the second click (and the dblclick) land on a different element.
        paletteDots.forEach((dot, index) => {
            const color = store.palette[index];
            if (!color) {
                return;
            }
            const hex = colorToHex(color);
            dot.style.background = hex;
            dot.classList.toggle('active', hex === foregroundHex);
            const keyHint = paletteKeyHint(index);
            dot.title = keyHint ? `${hex} (${keyHint})` : hex;
        });
    }
    const paletteSection = h('div', { class: 'options-section palette-section' }, [
        h('span', { class: 'row-label', text: 'Palette' }),
        paletteStrip,
    ]);

    const zoomSection = h('div', { class: 'options-section' }, [
        zoomLabel,
        h('button', { class: 'btn', text: 'Fit', onclick: () => fitToView() }),
        h('button', { class: 'btn', text: '100%', onclick: () => zoomToScale(1) }),
    ]);

    const resizeLock = document.createElement('input');
    resizeLock.type = 'checkbox';
    resizeLock.checked = true;
    resizeLock.title = 'Keep the current aspect ratio while resizing.';
    let resizeRatio = 1;
    const resizeWidthInput = numberInput(store.width || 512, 1, 100000, 1, () => undefined);
    resizeWidthInput.title = 'Target document width in pixels.';
    const resizeHeightInput = numberInput(store.height || 512, 1, 100000, 1, () => undefined);
    resizeHeightInput.title = 'Target document height in pixels.';
    resizeWidthInput.addEventListener('input', () => {
        if (resizeLock.checked) {
            const ratio = resizeRatio || 1;
            resizeHeightInput.value = String(Math.max(1, Math.round(readNumber(resizeWidthInput) / ratio)));
        }
    });
    resizeHeightInput.addEventListener('input', () => {
        if (resizeLock.checked) {
            const ratio = resizeRatio || 1;
            resizeWidthInput.value = String(Math.max(1, Math.round(readNumber(resizeHeightInput) * ratio)));
        }
    });
    resizeLock.addEventListener('change', () => {
        resizeRatio = readNumber(resizeWidthInput) / Math.max(1, readNumber(resizeHeightInput));
    });
    const resizeScaleCheckbox = document.createElement('input');
    resizeScaleCheckbox.type = 'checkbox';
    resizeScaleCheckbox.title = 'Scale the image content with the canvas. When off, only the canvas size changes.';

    // Applies the width/height fields (used by both Enter/blur and the button).
    function applyResizeFromInputs(): void {
        if (!store.current) {
            return;
        }
        const width = Math.max(1, Math.round(readNumber(resizeWidthInput)));
        const height = Math.max(1, Math.round(readNumber(resizeHeightInput)));
        if (width === store.width && height === store.height) {
            return;
        }
        commitFloating();
        if (resizeScaleCheckbox.checked) {
            store.resizeDocument(width, height);
        } else {
            store.resizeCanvas(width, height, 0, 0);
        }
    }

    resizeWidthInput.addEventListener('change', applyResizeFromInputs);
    resizeHeightInput.addEventListener('change', applyResizeFromInputs);

    const resizeApplyButton = h('button', {
        class: 'btn',
        text: 'Resize Image',
        onclick: () => applyResizeFromInputs(),
    });
    const resizeSection = h('div', { class: 'options-section' }, [
        h('span', { class: 'row-label', text: 'Width' }),
        resizeWidthInput,
        h('span', { class: 'row-label', text: 'Height' }),
        resizeHeightInput,
        h('span', { class: 'row-label', text: 'Lock' }),
        resizeLock,
        h('span', { class: 'row-label', text: 'Scale' }),
        resizeScaleCheckbox,
        resizeApplyButton,
    ]);

    const hintLabel = h('span', { class: 'row-label' });
    const hintSection = h('div', { class: 'options-section' }, [hintLabel]);

    const textSizeInput = numberInput(store.textSize, 1, 500, 1, () => store.setTextSize(readNumber(textSizeInput)));
    textSizeInput.title = 'Text size in pixels.';

    const textFontSelect = h('select', { class: 'select' });
    for (const [value, label] of [
        ['sans-serif', 'Sans'],
        ['serif', 'Serif'],
        ['monospace', 'Mono'],
        ['cursive', 'Cursive'],
        ['fantasy', 'Fantasy'],
    ] as [string, string][]) {
        textFontSelect.append(h('option', { value, text: label }));
    }
    textFontSelect.value = store.textFont;
    textFontSelect.title = 'Font family for the text tool.';
    textFontSelect.addEventListener('change', () => store.setTextFont(textFontSelect.value));

    const textBoldCheckbox = document.createElement('input');
    textBoldCheckbox.type = 'checkbox';
    textBoldCheckbox.checked = store.textBold;
    textBoldCheckbox.title = 'Render the text in bold.';
    textBoldCheckbox.addEventListener('change', () => store.setTextBold(textBoldCheckbox.checked));

    const textItalicCheckbox = document.createElement('input');
    textItalicCheckbox.type = 'checkbox';
    textItalicCheckbox.checked = store.textItalic;
    textItalicCheckbox.title = 'Render the text in italics.';
    textItalicCheckbox.addEventListener('change', () => store.setTextItalic(textItalicCheckbox.checked));

    const textShadowCheckbox = document.createElement('input');
    textShadowCheckbox.type = 'checkbox';
    textShadowCheckbox.checked = store.textShadow;
    textShadowCheckbox.title = 'Add a soft drop shadow behind the text while writing and after committing.';
    textShadowCheckbox.addEventListener('change', () => store.setTextShadow(textShadowCheckbox.checked));

    const textSwatch = h('span', { class: 'palette-swatch small' });
    const textPickButton = h('button', {
        class: 'btn',
        text: 'Color',
        title: 'Pick the text color; changes apply immediately.',
        onclick: async () => {
            const chosen = await ctx.selectColor(store.foreground, (color) => store.setForeground(color));
            store.setForeground(chosen);
        },
    });

    const textSection = h('div', { class: 'options-section' }, [
        h('span', { class: 'row-label', text: 'Size' }),
        textSizeInput,
        h('span', { class: 'row-label', text: 'Font' }),
        textFontSelect,
        h('span', { class: 'row-label', text: 'Bold' }),
        textBoldCheckbox,
        h('span', { class: 'row-label', text: 'Italic' }),
        textItalicCheckbox,
        h('span', { class: 'row-label', text: 'Shadow' }),
        textShadowCheckbox,
        textSwatch,
        textPickButton,
    ]);

    const element = h('div', { class: 'options-bar' }, [
        brushSection,
        knifeSection,
        bucketSection,
        wandSection,
        zoomSection,
        resizeSection,
        textSection,
        paletteSection,
        hintSection,
    ]);

    function refresh(): void {
        if (document.activeElement !== brushSizeInput) {
            brushSizeInput.value = String(store.activeBrushSize);
        }
        brushSizeInput.title =
            store.activeTool === 'eraser' && !store.settings.shareEraserSize
                ? 'Eraser size in pixels.'
                : 'Brush size in pixels.';
        if (document.activeElement !== brushOpacityInput) {
            brushOpacityInput.value = String(Math.round(store.brushOpacity * 100));
        }
        if (document.activeElement !== wandToleranceInput) {
            wandToleranceInput.value = String(store.wandTolerance);
        }
        if (document.activeElement !== fillToleranceInput) {
            fillToleranceInput.value = String(store.fillTolerance);
        }
        if (document.activeElement !== textSizeInput) {
            textSizeInput.value = String(store.textSize);
        }
        textFontSelect.value = store.textFont;
        textBoldCheckbox.checked = store.textBold;
        textItalicCheckbox.checked = store.textItalic;
        textShadowCheckbox.checked = store.textShadow;
        textSwatch.style.background = `rgb(${store.foreground.r}, ${store.foreground.g}, ${store.foreground.b})`;
        renderPaletteStrip();
        if (document.activeElement !== resizeWidthInput && store.width > 0) {
            resizeWidthInput.value = String(store.width);
            resizeRatio = store.width / Math.max(1, store.height);
        }
        if (document.activeElement !== resizeHeightInput && store.height > 0) {
            resizeHeightInput.value = String(store.height);
        }
        brushSwatch.style.background = `rgb(${store.foreground.r}, ${store.foreground.g}, ${store.foreground.b})`;
        brushSelect.value = store.brushId;
        knifeSelect.value = store.brushId;
        if (document.activeElement !== knifeSizeInput) {
            knifeSizeInput.value = String(store.brushSize);
        }
        if (document.activeElement !== knifeStrengthInput) {
            knifeStrengthInput.value = String(Math.round(store.brushOpacity * 100));
        }
        if (document.activeElement !== knifeSmearInput) {
            knifeSmearInput.value = String(Math.round(store.knifeSmear * 100));
        }

        const tool = store.activeTool;
        const showKnife = tool === 'knife';
        const showBrush = isBrushTool(tool) && !showKnife;
        const showBucket = tool === 'bucket';
        const showWand = tool === 'wand';
        const showZoom = tool === 'zoom';
        const showResize = tool === 'resize';
        const showText = tool === 'text';
        const showPalette = tool === 'brush' || tool === 'bucket' || tool === 'text';
        brushSection.style.display = showBrush ? 'flex' : 'none';
        knifeSection.style.display = showKnife ? 'flex' : 'none';
        bucketSection.style.display = showBucket ? 'flex' : 'none';
        wandSection.style.display = showWand ? 'flex' : 'none';
        zoomSection.style.display = showZoom ? 'flex' : 'none';
        resizeSection.style.display = showResize ? 'flex' : 'none';
        textSection.style.display = showText ? 'flex' : 'none';
        paletteSection.style.display = showPalette ? 'flex' : 'none';
        hintSection.style.display =
            showBrush || showKnife || showBucket || showWand || showZoom || showResize || showText ? 'none' : 'flex';
        hintLabel.textContent = `${tool[0].toUpperCase() + tool.slice(1)}`;
    }

    return { element, resizeWidthInput, resizeHeightInput, resizeScaleCheckbox, refresh };
}
