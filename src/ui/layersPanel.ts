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
  let lastSignature = '';

  const render = (): void => {
    const signature =
      store.layers.map((layer) => `${layer.id}:${layer.visible}:${layer.name}`).join('|') + `|${store.activeIndex}`;
    if (signature === lastSignature) {
      return;
    }
    lastSignature = signature;
    list.replaceChildren();
    for (let i = store.layers.length - 1; i >= 0; i--) {
      const layer = store.layers[i];
      const visibility = document.createElement('input');
      visibility.type = 'checkbox';
      visibility.checked = layer.visible;
      visibility.title = 'Toggle visibility';
      visibility.addEventListener('click', (event) => event.stopPropagation());
      visibility.addEventListener('change', () => store.setLayerVisible(i, visibility.checked));

      const row = h('div', { class: `layer-item${i === store.activeIndex ? ' active' : ''}` }, [
        visibility,
        h('span', { class: 'layer-name', text: layer.name }),
      ]);
      row.addEventListener('click', () => store.setActiveLayer(i));
      list.append(row);
    }
  };
  render();
  unlisten = store.onChange(render);

  panel.body.append(
    h('div', { class: 'tab-content' }, [
      h('div', { class: 'fill' }, [list]),
      h('div', { class: 'button-row' }, [
        button('New Layer', () => store.addLayer()),
        button('Merge Layers', () => store.mergeLayers()),
        button('Delete Layer', () => store.deleteLayer()),
      ]),
      h('div', { class: 'dialog-hint', text: 'Shift+Ctrl+N: New Layer · Ctrl+E: Merge Layers' }),
    ]),
  );

  return panel;
}
