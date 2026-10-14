import { AppContext } from '../context';
import { accordionSection, button, createDockPanel, DockPanel, h, num, numeric, rowHint } from '../shared/dom';
import { MAX_SYMMETRY_SEGMENTS, MIN_SYMMETRY_SEGMENTS, SymmetryMode } from '../core/modifiers';

export function openModifiersPanel(ctx: AppContext, onClose?: () => void): DockPanel {
    const { store } = ctx;
    let unlisten: (() => void) | null = null;
    const panel = createDockPanel(ctx.dock, 'Modifiers', () => {
        // Leaving the panel should not leave the canvas in guide-transform mode.
        store.setSymmetry({ transformMode: false });
        unlisten?.();
        onClose?.();
    });

    // --- Symmetry ---

    const enabledCheckbox = document.createElement('input');
    enabledCheckbox.type = 'checkbox';
    enabledCheckbox.addEventListener('change', () =>
        store.setSymmetry({ enabled: enabledCheckbox.checked }),
    );

    const modeSelect = h('select', { class: 'select' }, [
        h('option', { value: 'mirror', text: 'Mirror' }),
        h('option', { value: 'rotational', text: 'Rotational' }),
    ]);
    modeSelect.addEventListener('change', () =>
        store.setSymmetry({ mode: modeSelect.value as SymmetryMode }),
    );

    const transformButton = button('Transform Guide', () => {
        const active = !store.symmetry.transformMode;
        store.setSymmetry({ transformMode: active, enabled: active || store.symmetry.enabled });
    });
    transformButton.title =
        'Drag on the image to move the symmetry guide: drag the line to move it, or drag one of the knobs near its center to rotate it.';

    const segmentsInput = numeric(2, {
        min: MIN_SYMMETRY_SEGMENTS,
        max: MAX_SYMMETRY_SEGMENTS,
        step: 1,
        width: 100,
    });
    segmentsInput.addEventListener('input', () =>
        store.setSymmetry({ segments: Math.round(num(segmentsInput)) }),
    );
    segmentsInput.title = 'Number of rotational copies, including the original.';

    const segmentsRow = rowHint(
        'Segments:',
        'Number of rotational copies, including the original.',
        segmentsInput,
    );

    const centerButton = button('Center on Image', () => {
        if (store.width > 0 && store.height > 0) {
            store.setSymmetry({ cx: store.width / 2, cy: store.height / 2 });
        }
    });
    centerButton.title = 'Move the guide to the middle of the image.';

    const usageHint = h('div', {
        class: 'panel-hint',
        text:
            'Drag the line to move it, or drag one of the knobs near its center to rotate it. Hold Shift to snap the angle. Escape leaves transform mode.',
    });
    usageHint.style.display = 'none';

    const symmetryBody = h('div', {}, [
        rowHint(
            'Enabled:',
            'While enabled, brush, eraser, clone, heal, knife and paint bucket strokes are mirrored live.',
            enabledCheckbox,
        ),
        rowHint('Mode:', 'Mirror reflects strokes across the guide line; Rotational spins copies around its center.', modeSelect),
        rowHint('Transform:', 'Toggle guide transform mode, then drag it directly on the image.', transformButton),
        segmentsRow,
        h('div', { class: 'button-row' }, [centerButton]),
        usageHint,
    ]);
    const symmetrySection = accordionSection(
        'Symmetry',
        'Mirror or rotate brush strokes and paint-bucket fills around a guide line.',
        symmetryBody,
    );

    // --- Palette Lock ---

    const lockCheckbox = document.createElement('input');
    lockCheckbox.type = 'checkbox';
    lockCheckbox.addEventListener('change', () => store.setPaletteLock({ enabled: lockCheckbox.checked }));

    const autoApplyCheckbox = document.createElement('input');
    autoApplyCheckbox.type = 'checkbox';
    autoApplyCheckbox.addEventListener('change', () =>
        store.setPaletteLock({ applyOnPaletteChange: autoApplyCheckbox.checked }),
    );

    const applyButton = button('Apply Palette to Image', () => void ctx.applyPaletteToImage());
    applyButton.title = "Remap the active layer's pixels to the nearest palette colors.";

    const paletteLockBody = h('div', {}, [
        rowHint(
            'Lock drawing:',
            'Brush, paint bucket and text colors snap to the nearest palette color while enabled.',
            lockCheckbox,
        ),
        rowHint(
            'Apply on palette change:',
            'When a palette color is edited, recolor every matching pixel of the active layer to the new color.',
            autoApplyCheckbox,
        ),
        h('div', { class: 'button-row' }, [applyButton]),
    ]);
    const paletteLockSection = accordionSection(
        'Palette Lock',
        'Keep drawing (and optionally the image) on the palette colors.',
        paletteLockBody,
    );

    panel.body.append(symmetrySection, paletteLockSection);

    const sync = (): void => {
        const sym = store.symmetry;
        enabledCheckbox.checked = sym.enabled;
        modeSelect.value = sym.mode;
        transformButton.classList.toggle('active', sym.transformMode);
        transformButton.textContent = sym.transformMode ? 'Finish Transform' : 'Transform Guide';
        if (document.activeElement !== segmentsInput) {
            segmentsInput.value = String(Math.round(sym.segments));
        }
        segmentsRow.style.display = sym.mode === 'rotational' ? 'flex' : 'none';
        usageHint.style.display = sym.transformMode ? 'block' : 'none';
        centerButton.disabled = store.width === 0 || store.height === 0;

        lockCheckbox.checked = store.paletteLock.enabled;
        autoApplyCheckbox.checked = store.paletteLock.applyOnPaletteChange;
        applyButton.disabled = store.working || store.palette.length === 0 || !store.activeImage;
    };
    sync();
    unlisten = store.onChange(sync);

    return panel;
}
