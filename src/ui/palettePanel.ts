import { colorToHex, colorToHsl, distinctColors, hexToColor, hslToColor, RGB } from '../shared/color';
import { AppContext } from '../context';
import { button, colorSwatch, createDockPanel, createTabs, DockPanel, h, num, numeric, rowHint } from '../shared/dom';
import { loadTextFile, saveTextFile } from '../shared/files';
import { fakeDuoTone, hueClusters, kMeans, medianCut, sectorsHighMidLow, sortColors, sortHueClusters } from '../core/palette';

export function openPalettePanel(ctx: AppContext, onClose?: () => void): DockPanel {
    let unlisten: (() => void) | null = null;
    const panel = createDockPanel(ctx.dock, 'Palette', () => {
        unlisten?.();
        onClose?.();
    });
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
                    // Select first so the emit inside setPaletteColor renders the
                    // highlight correctly; renderList also covers the early return
                    // when the chosen color is unchanged.
                    selectedIndex = index;
                    store.setPaletteColor(index, result);
                    renderList();
                    // Editing the color that is currently in use also applies it as the
                    // current brush/text color.
                    if (wasActive) {
                        store.setForeground(result);
                    }
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
    };

    renderList();
    // The palette can also change outside this panel (options-bar strip, undo,
    // Restore), so keep the list in sync with the store.
    unlisten = store.onChange(renderList);

    const colorsTab = h('div', { class: 'tab-content' }, [
        h('div', { class: 'fill' }, [list]),
        h('div', { class: 'button-row' }, [
            button('Clear Palette', () => {
                selectedIndex = -1;
                store.clearPalette();
            }),
            button('Remove Color', () => {
                if (selectedIndex >= 0 && selectedIndex < store.palette.length) {
                    const index = selectedIndex;
                    selectedIndex = -1;
                    store.removePaletteColor(index);
                }
            }),
            button('Add Color', async () => {
                const result = await ctx.selectColor();
                store.addPaletteColor(result);
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
                const generated = await ctx.runTask('Generating palette', () => medianCut(image, amount));
                selectedIndex = -1;
                store.setPalette(generated);
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
                const generated = await ctx.runTask('Generating palette', () => kMeans(image, amount, steps));
                selectedIndex = -1;
                store.setPalette(generated);
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
                const generated = await ctx.runTask('Generating palette', () => sectorsHighMidLow(image, amount));
                selectedIndex = -1;
                store.setPalette(generated);
            }),
        ]),
    ]);

    // --- Hue Clusters tab ---
    const hueClustersAmount = numeric(3, { min: 2, width: 200 });
    const hueClustersPerCluster = numeric(2, { min: 1, width: 200 });
    const hueClustersTab = h('div', { class: 'tab-content' }, [
        rowHint(
            'Hue clusters:',
            'The occupied hue range is split into this many equal parts, so a dominant hue cannot crowd out rarer ones; parts with no colors are skipped. The darkest and brightest image colors are always included.',
            hueClustersAmount,
        ),
        rowHint(
            'Colors per cluster:',
            'Colors picked from each hue cluster, chosen to be as far apart from each other as possible.',
            hueClustersPerCluster,
        ),
        h('div', { class: 'button-row' }, [
            button('Preview Hue Clusters', async () => {
                if (!store.activeImage) {
                    return;
                }
                const amount = Math.trunc(num(hueClustersAmount));
                const image = store.activeImage;
                const result = await ctx.runTask('Sorting image', () => sortHueClusters(image, amount));
                ctx.applyImage(result);
            }),
            button('Generate Hue Clusters Palette', async () => {
                if (!store.activeImage) {
                    return;
                }
                const amount = Math.trunc(num(hueClustersAmount));
                const perCluster = Math.trunc(num(hueClustersPerCluster));
                const image = store.activeImage;
                const generated = await ctx.runTask('Generating palette', () => hueClusters(image, amount, perCluster));
                selectedIndex = -1;
                store.setPalette(generated);
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
                const generated = await ctx.runTask('Generating palette', () => fakeDuoTone(amount, hue, saturation));
                selectedIndex = -1;
                store.setPalette(generated);
            }),
            button('Add Duo Tone To Current Palette', async () => {
                const amount = Math.trunc(num(duoToneAmount));
                const hue = num(duoToneHue) % 360;
                const saturation = num(duoToneSaturation);
                const generated = await ctx.runTask('Generating palette', () => fakeDuoTone(amount, hue, saturation));
                selectedIndex = -1;
                store.setPalette(distinctColors([...store.palette, ...generated]));
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
                selectedIndex = -1;
                store.setPalette(distinctColors(colors));
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
            { label: 'Hue Clusters', content: hueClustersTab },
            { label: 'Duo Tone', content: duoToneTab },
            { label: 'Import/Export', content: importExportTab },
        ]),
    );

    return panel;
}
