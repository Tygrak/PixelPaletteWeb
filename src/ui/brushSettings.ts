// Brush editor shown inside the Settings panel: pick any brush (built-in or
// user-created), edit every parameter, duplicate it into a new custom brush,
// delete custom brushes, and revert built-in ones to their defaults. All
// changes persist through brushLibrary (localStorage).

import {
  addBrush,
  allBrushes,
  BrushUpdate,
  deleteBrush,
  isDefaultBrush,
  isModifiedBrush,
  onBrushesChanged,
  revertBrush,
  updateBrush,
} from '../brushLibrary';
import { DEFAULT_BRUSH_ID, TextureKind } from '../brushes';
import { clamp } from '../color';
import { h, num, numeric, rowHint } from '../dom';
import { Store } from '../store';

const RAD_TO_DEG = 180 / Math.PI;
const DEG_TO_RAD = Math.PI / 180;
const TEXTURE_KINDS: TextureKind[] = ['none', 'noise', 'chalk', 'grain', 'fibers', 'hatch'];

export interface BrushSettingsSection {
  root: HTMLElement;
  dispose: () => void;
}

export function createBrushSettingsSection(store: Store): BrushSettingsSection {
  let selectedId = store.brushId;

  const section = h('div', { class: 'brush-settings' });

  const toggle = h(
    'button',
    {
      class: 'brush-settings-toggle',
      title:
        'Adjust every brush parameter, duplicate brushes and revert built-ins to their defaults. Changes are saved in this browser.',
    },
    [h('span', { class: 'brush-settings-arrow', text: '▶' }), h('span', { text: 'Brush settings' })],
  );

  const select = h('select', { class: 'select' });
  select.title = 'Choose a brush to edit; this also selects it for painting.';
  select.addEventListener('change', () => {
    selectedId = select.value;
    store.setBrush(selectedId);
    renderDetails();
  });

  const addButton = h('button', {
    class: 'btn',
    text: 'Duplicate Brush',
    title: 'Create a new custom brush from the selected one.',
    onclick: () => {
      selectedId = addBrush(selectedId);
      refreshSelect();
      renderDetails();
    },
  });

  const details = h('div', { class: 'brush-details' });
  let revertButton: HTMLButtonElement | null = null;

  function refreshSelect(): void {
    const brushes = allBrushes();
    select.replaceChildren(
      ...brushes.map((brush) =>
        h('option', { value: brush.id, text: isModifiedBrush(brush.id) ? `${brush.label} *` : brush.label }),
      ),
    );
    if (!brushes.some((brush) => brush.id === selectedId)) {
      selectedId = DEFAULT_BRUSH_ID;
    }
    select.value = selectedId;
    // Edits enable the revert button without re-rendering the detail inputs
    // (which would steal focus while typing).
    if (revertButton) {
      revertButton.disabled = !isModifiedBrush(selectedId);
    }
  }

  function numberRow(
    label: string,
    hint: string,
    value: number,
    min: number,
    max: number,
    step: number,
    apply: (value: number) => void,
  ): HTMLElement {
    const input = numeric(Math.round(value * 1000) / 1000, { min, max, step, width: 90 });
    input.addEventListener('input', () => apply(clamp(num(input), min, max)));
    return rowHint(label, hint, input);
  }

  function checkboxRow(
    label: string,
    hint: string,
    checked: boolean,
    apply: (value: boolean) => void,
  ): HTMLElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => apply(input.checked));
    return rowHint(label, hint, input);
  }

  function renderDetails(): void {
    details.replaceChildren();
    revertButton = null;
    const brush = allBrushes().find((item) => item.id === selectedId);
    if (!brush) {
      return;
    }
    const patch = (update: BrushUpdate): void => updateBrush(brush.id, update);

    const nameInput = h('input', { type: 'text', value: brush.label });
    nameInput.style.width = '180px';
    nameInput.addEventListener('input', () => {
      if (nameInput.value.trim() !== '') {
        patch({ label: nameInput.value });
      }
    });

    const kindSelect = h('select', { class: 'select' });
    for (const kind of TEXTURE_KINDS) {
      kindSelect.append(h('option', { value: kind, text: kind }));
    }
    kindSelect.value = brush.texture.kind;
    kindSelect.addEventListener('change', () =>
      patch((current) => ({ texture: { ...current.texture, kind: kindSelect.value as TextureKind } })),
    );

    const actions: HTMLButtonElement[] = [];
    if (isDefaultBrush(brush.id)) {
      const revert = h('button', {
        class: 'btn',
        text: 'Revert to Defaults',
        title: 'Restore this brush to its built-in settings.',
        onclick: () => {
          revertBrush(brush.id);
          refreshSelect();
          renderDetails();
        },
      });
      revert.disabled = !isModifiedBrush(brush.id);
      revertButton = revert;
      actions.push(revert);
    } else {
      actions.push(
        h('button', {
          class: 'btn',
          text: 'Delete Brush',
          title: 'Remove this custom brush.',
          onclick: () => {
            deleteBrush(brush.id);
            selectedId = DEFAULT_BRUSH_ID;
            refreshSelect();
            renderDetails();
          },
        }),
      );
    }

    details.append(
      rowHint('Name:', 'Label shown in the brush pickers.', nameInput),
      h('div', { class: 'brush-group-title', text: 'Tip' }),
      numberRow('Roundness:', '1 = circle; lower values flatten the tip into an ellipse.', brush.roundness, 0.05, 1, 0.05, (value) => patch({ roundness: value })),
      numberRow('Angle (°):', 'Tip rotation, only visible on flattened or lobed tips.', brush.angle * RAD_TO_DEG, -180, 180, 5, (value) => patch({ angle: value * DEG_TO_RAD })),
      numberRow('Hardness:', '1 = crisp edge; 0 = transparency fades from the center.', brush.hardness, 0, 1, 0.01, (value) => patch({ hardness: value })),
      numberRow('Spacing:', 'Stamp spacing as a fraction of the radius; lower is smoother.', brush.spacing, 0.01, 2, 0.01, (value) => patch({ spacing: value })),
      checkboxRow('Antialias:', 'Off paints exact hard pixels (pencil-style).', brush.antialias, (value) => patch({ antialias: value })),
      checkboxRow('Pixel mode:', 'Each touched pixel is painted at full opacity.', brush.pixel, (value) => patch({ pixel: value })),
      h('div', { class: 'brush-group-title', text: 'Pressure' }),
      numberRow('Size min:', 'Tip size factor at zero pressure (1 ignores pressure).', brush.pressure.sizeMin, 0, 1, 0.01, (value) => patch((current) => ({ pressure: { ...current.pressure, sizeMin: value } }))),
      numberRow('Size curve:', 'Shapes how size follows pressure; 1 is linear.', brush.pressure.sizeCurve, 0.1, 4, 0.05, (value) => patch((current) => ({ pressure: { ...current.pressure, sizeCurve: value } }))),
      numberRow('Alpha min:', 'Opacity factor at zero pressure (1 ignores pressure).', brush.pressure.alphaMin, 0, 1, 0.01, (value) => patch((current) => ({ pressure: { ...current.pressure, alphaMin: value } }))),
      numberRow('Alpha curve:', 'Shapes how opacity follows pressure; 1 is linear.', brush.pressure.alphaCurve, 0.1, 4, 0.05, (value) => patch((current) => ({ pressure: { ...current.pressure, alphaCurve: value } }))),
      h('div', { class: 'brush-group-title', text: 'Texture' }),
      rowHint('Kind:', 'Procedural grain applied along the stroke.', kindSelect),
      checkboxRow('Document space:', 'Pin the texture to the canvas instead of the stroke, so separate strokes line up (hatching).', brush.documentTexture, (value) => patch({ documentTexture: value })),
      numberRow('Scale:', 'Feature size in pixels (bigger = coarser grain).', brush.texture.scale, 0.5, 32, 0.1, (value) => patch((current) => ({ texture: { ...current.texture, scale: value } }))),
      numberRow('Min:', 'Coverage where the texture is darkest; raise it to keep a floor of paint in the gaps.', brush.texture.min, 0, 1, 0.01, (value) => patch((current) => ({ texture: { ...current.texture, min: value, max: Math.max(current.texture.max, value) } }))),
      numberRow('Max:', 'Coverage where the texture is lightest; lower it to keep even the highlights translucent.', brush.texture.max, 0, 1, 0.01, (value) => patch((current) => ({ texture: { ...current.texture, max: value, min: Math.min(current.texture.min, value) } }))),
      numberRow('Contrast:', 'Pushes texture values toward on/off so marks break up into gaps.', brush.texture.contrast, 0, 1, 0.01, (value) => patch((current) => ({ texture: { ...current.texture, contrast: value } }))),
      numberRow('Angle (°):', 'Line orientation for directional textures.', brush.texture.angle * RAD_TO_DEG, -180, 180, 5, (value) => patch((current) => ({ texture: { ...current.texture, angle: value * DEG_TO_RAD } }))),
      h('div', { class: 'brush-group-title', text: 'Shape' }),
      numberRow('Lobes:', 'Scalloped lobes around the rim (1 = plain tip).', brush.lobes, 1, 16, 1, (value) => patch({ lobes: Math.round(value) })),
      numberRow('Lobe depth:', 'Depth of the lobes; 0 disables them.', brush.lobeDepth, 0, 1, 0.01, (value) => patch({ lobeDepth: value })),
      numberRow('Rotation jitter (°):', 'Random per-stamp tip rotation while drawing.', brush.rotationJitter * RAD_TO_DEG, 0, 360, 5, (value) => patch({ rotationJitter: value * DEG_TO_RAD })),
      numberRow('Edge texture:', '1 = grain builds toward the rim; 0 = grain across the whole tip.', brush.edgeTexture, 0, 1, 0.01, (value) => patch({ edgeTexture: value })),
      h('div', { class: 'button-row' }, actions),
    );
  }

  // Mirrors the main brush pickers: choosing a brush in the toolbar or in the
  // palette knife options switches the editor too (and vice versa).
  function syncFromStore(): void {
    if (store.brushId !== selectedId) {
      selectedId = store.brushId;
      refreshSelect();
      renderDetails();
    }
  }

  const unlisten = onBrushesChanged(refreshSelect);
  const unlistenStore = store.onChange(syncFromStore);
  refreshSelect();
  renderDetails();

  const root = h('div', { class: 'brush-settings-wrap' }, [toggle, section]);
  toggle.addEventListener('click', () => root.classList.toggle('open'));
  section.append(
    rowHint('Edit brush:', 'Choose a brush to edit, or duplicate one into a new custom brush.', select, addButton),
    h('div', { class: 'divider' }),
    details,
  );

  return {
    root,
    dispose: () => {
      unlisten();
      unlistenStore();
    },
  };
}
