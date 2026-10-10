// Compact layers list shown at the bottom of the sidebar while the full
// docked Layers panel is closed. It lists the layers, lets you select and
// reorder them, and has add / delete buttons.

import { h } from '../dom';
import { EYE_ICON, EYE_OFF_ICON } from '../icons';
import { Store } from '../store';

export interface MiniLayers {
  root: HTMLElement;
  sync(): void;
}

const WRAP = (inner: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const PLUS_ICON = WRAP('<path d="M12 5v14M5 12h14"/>');
const TRASH_ICON = WRAP(
  '<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
);

export function createMiniLayers(store: Store, isFullPanelOpen: () => boolean): MiniLayers {
  const list = h('div', { class: 'mini-layer-list' });

  const addButton = h('button', {
    class: 'mini-layers-btn',
    title: 'Add layer (Ctrl+N)',
    onclick: () => store.addLayer(),
  });
  addButton.innerHTML = PLUS_ICON;

  const deleteButton = h('button', {
    class: 'mini-layers-btn',
    title: 'Delete layer',
    onclick: () => store.deleteLayer(),
  });
  deleteButton.innerHTML = TRASH_ICON;

  const root = h('div', { class: 'mini-layers' }, [
    h('div', { class: 'mini-layers-head' }, [
      h('span', { class: 'mini-layers-title', text: 'Layers' }),
      addButton,
      deleteButton,
    ]),
    list,
  ]);

  let lastStructure = '';
  let lastActive = -1;
  let rowElements: HTMLElement[] = [];
  let ignoreNextClick = false;

  let dragState: {
    fromDisplay: number;
    startY: number;
    row: HTMLElement;
    moved: boolean;
    targetDisplay: number;
    pointerId: number;
  } | null = null;

  const clearDropClasses = (): void => {
    for (const row of rowElements) {
      row.classList.remove('drop-above', 'drop-below');
    }
  };

  const onRowDown = (event: PointerEvent, row: HTMLElement): void => {
    if (event.button !== 0) {
      return;
    }
    const fromDisplay = rowElements.indexOf(row);
    if (fromDisplay < 0) {
      return;
    }
    dragState = {
      fromDisplay,
      startY: event.clientY,
      row,
      moved: false,
      targetDisplay: fromDisplay,
      pointerId: event.pointerId,
    };
  };

  const onRowMove = (event: PointerEvent): void => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    if (!dragState.moved && Math.abs(event.clientY - dragState.startY) < 4) {
      return;
    }
    if (!dragState.moved) {
      dragState.moved = true;
      dragState.row.setPointerCapture(event.pointerId);
      dragState.row.classList.add('dragging');
    }
    let target = rowElements.length;
    for (let d = 0; d < rowElements.length; d++) {
      const rect = rowElements[d].getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        target = d;
        break;
      }
    }
    dragState.targetDisplay = target;
    clearDropClasses();
    if (target < rowElements.length) {
      rowElements[target].classList.add('drop-above');
    } else {
      rowElements[rowElements.length - 1]?.classList.add('drop-below');
    }
  };

  const onRowUp = (event: PointerEvent): void => {
    if (!dragState || event.pointerId !== dragState.pointerId) {
      return;
    }
    const state = dragState;
    dragState = null;
    for (const row of rowElements) {
      row.classList.remove('dragging');
    }
    clearDropClasses();
    if (state.moved && state.row.hasPointerCapture(event.pointerId)) {
      state.row.releasePointerCapture(event.pointerId);
    }
    if (!state.moved) {
      return;
    }
    ignoreNextClick = true;
    const displayIds = rowElements.map((row) => Number(row.dataset.id));
    const from = state.fromDisplay;
    let insertAt = state.targetDisplay > from ? state.targetDisplay - 1 : state.targetDisplay;
    insertAt = Math.max(0, Math.min(displayIds.length - 1, insertAt));
    const [moved] = displayIds.splice(from, 1);
    displayIds.splice(insertAt, 0, moved);
    store.reorderLayers(displayIds.slice().reverse());
  };

  const updateActive = (): void => {
    rowElements.forEach((row, display) => {
      const index = store.layers.length - 1 - display;
      row.classList.toggle('active', index === store.activeIndex);
    });
  };

  const rebuild = (): void => {
    list.replaceChildren();
    rowElements = [];
    for (let i = store.layers.length - 1; i >= 0; i--) {
      const layer = store.layers[i];
      const eye = h('button', {
        class: `layer-eye${layer.visible ? '' : ' off'}`,
        title: layer.visible ? 'Hide layer' : 'Show layer',
      });
      eye.innerHTML = layer.visible ? EYE_ICON : EYE_OFF_ICON;
      eye.addEventListener('pointerdown', (event) => event.stopPropagation());
      eye.addEventListener('click', (event) => {
        event.stopPropagation();
        store.setLayerVisible(i, !layer.visible);
      });
      const row = h('div', { class: 'mini-layer-item' }, [
        eye,
        h('span', { class: 'mini-layer-name', text: layer.name, title: layer.name }),
      ]);
      row.dataset.id = String(layer.id);
      row.addEventListener('click', () => {
        if (ignoreNextClick) {
          ignoreNextClick = false;
          return;
        }
        store.setActiveLayer(i);
      });
      row.addEventListener('pointerdown', (event) => onRowDown(event, row));
      row.addEventListener('pointermove', onRowMove);
      row.addEventListener('pointerup', onRowUp);
      row.addEventListener('pointercancel', onRowUp);
      list.append(row);
      rowElements.push(row);
    }
  };

  function sync(): void {
    const show = store.layers.length > 0 && !isFullPanelOpen();
    root.classList.toggle('hidden', !show);
    if (!show) {
      return;
    }
    const structure = store.layers.map((layer) => `${layer.id}:${layer.visible}:${layer.name}`).join('|');
    if (structure !== lastStructure) {
      lastStructure = structure;
      rebuild();
    }
    if (store.activeIndex !== lastActive || structure === lastStructure) {
      lastActive = store.activeIndex;
      updateActive();
    }
    addButton.disabled = false;
    deleteButton.disabled = store.layers.length < 2;
  }

  return { root, sync };
}
