import { AppContext } from '../context';
import { button, createDockPanel, DockPanel, h } from '../dom';

export function openLayersPanel(ctx: AppContext, onClose?: () => void): DockPanel {
  const { store } = ctx;
  let unlisten: (() => void) | null = null;
  const panel = createDockPanel(ctx.dock, 'Layers', () => {
    unlisten?.();
    onClose?.();
  });

  const list = h('div', { class: 'layer-list' });
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

  function startRename(row: HTMLElement, index: number, name: string): void {
    if (!row || row.querySelector('.layer-rename')) {
      return;
    }
    const nameEl = row.querySelector('.layer-name');
    if (!nameEl) {
      return;
    }
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'layer-rename';
    input.value = name;
    input.addEventListener('pointerdown', (event) => event.stopPropagation());
    let done = false;
    const commit = (save: boolean): void => {
      if (done) {
        return;
      }
      done = true;
      if (save) {
        store.renameLayer(index, input.value.trim());
      }
      render();
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        commit(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        commit(false);
      }
    });
    input.addEventListener('blur', () => commit(true));
    nameEl.replaceWith(input);
    input.focus();
    input.select();
  }

  const onRowDown = (event: PointerEvent, row: HTMLElement): void => {
    if ((event.target as HTMLElement).closest('input') || event.button !== 0) {
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

  const render = (): void => {
    const structure = store.layers.map((layer) => `${layer.id}:${layer.visible}:${layer.name}`).join('|');
    if (structure !== lastStructure) {
      lastStructure = structure;
      list.replaceChildren();
      rowElements = [];
      for (let i = store.layers.length - 1; i >= 0; i--) {
        const layer = store.layers[i];
        const visibility = document.createElement('input');
        visibility.type = 'checkbox';
        visibility.checked = layer.visible;
        visibility.title = 'Toggle visibility';
        visibility.addEventListener('click', (event) => event.stopPropagation());
        visibility.addEventListener('change', () => store.setLayerVisible(i, visibility.checked));

        const nameEl = h('span', { class: 'layer-name', text: layer.name, title: 'Double-click to rename' });

        const row = h('div', { class: 'layer-item' }, [visibility, nameEl]);
        row.dataset.id = String(layer.id);
        nameEl.addEventListener('dblclick', (event) => {
          event.stopPropagation();
          startRename(row, i, layer.name);
        });
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
    }
    if (store.activeIndex !== lastActive || structure === lastStructure) {
      lastActive = store.activeIndex;
      updateActive();
    }
  };
  render();
  unlisten = store.onChange(render);

  const renameActive = (): void => {
    const display = store.layers.length - 1 - store.activeIndex;
    const row = rowElements[display];
    const layer = store.layers[store.activeIndex];
    if (row && layer) {
      startRename(row, store.activeIndex, layer.name);
    }
  };

  panel.body.append(
    h('div', { class: 'tab-content' }, [
      h('div', { class: 'fill' }, [list]),
      h('div', { class: 'button-row' }, [
        button('New Layer', () => store.addLayer()),
        button('Rename Layer', () => renameActive()),
        button('Merge Down', () => store.mergeLayers()),
        button('Delete Layer', () => store.deleteLayer()),
      ]),
      h('div', {
        class: 'dialog-hint',
        text: 'Double-click a layer to rename · drag to reorder · Shift+Ctrl+N new · Ctrl+E merge down',
      }),
    ]),
  );

  return panel;
}
