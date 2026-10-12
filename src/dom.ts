import { RGB } from './color';

type Child = Node | string;
type Attrs = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === null || value === undefined || value === false) {
      continue;
    }
    if (key === 'class') {
      element.className = String(value);
    } else if (key === 'text') {
      element.textContent = String(value);
    } else if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key in element) {
      (element as unknown as Record<string, unknown>)[key] = value;
    } else {
      element.setAttribute(key, String(value));
    }
  }
  for (const child of children) {
    element.append(child);
  }
  return element;
}

export interface NumericOptions {
  min?: number;
  max?: number;
  step?: number;
  width?: number;
}

export function numeric(value: number, options: NumericOptions = {}): HTMLInputElement {
  const input = h('input', { type: 'number', value: String(value) });
  if (options.min !== undefined) {
    input.min = String(options.min);
  }
  if (options.max !== undefined) {
    input.max = String(options.max);
  }
  if (options.step !== undefined) {
    input.step = String(options.step);
  }
  if (options.width !== undefined) {
    input.style.width = `${options.width}px`;
  }
  return input;
}

export function num(input: HTMLInputElement): number {
  const value = parseFloat(input.value);
  return Number.isNaN(value) ? 0 : value;
}

export function row(label: string, ...controls: Child[]): HTMLElement {
  return h('div', { class: 'row' }, [
    h('span', { class: 'row-label', text: label }),
    h('div', { class: 'row-controls' }, controls),
  ]);
}

// A labelled row that shows helper text when hovered. The title is set on the
// row so it also appears while hovering the label or the control itself.
export function rowHint(label: string, hintText: string, ...controls: Child[]): HTMLElement {
  const element = row(label, ...controls);
  element.title = hintText;
  return element;
}

export function button(label: string, onClick: () => void, title?: string): HTMLButtonElement {
  const element = h('button', { class: 'btn', text: label, onclick: onClick });
  if (title) {
    element.title = title;
  }
  return element;
}

export interface Dialog {
  overlay: HTMLElement;
  body: HTMLElement;
  status: HTMLElement;
  // Right-aligned button group in the footer. Callers can append extra action
  // buttons next to the primary one so they sit in line.
  actions: HTMLElement;
  primary: HTMLButtonElement;
  close: () => void;
}

export function createDialog(
  title: string,
  width = 620,
  primaryLabel = 'Close',
  onClose?: () => void,
  modal = true,
): Dialog {
  let closed = false;
  const status = h('span', { class: 'dialog-status' });
  const body = h('div', { class: 'dialog-body' });
  const primary = h('button', {
    class: 'btn',
    text: primaryLabel,
    onclick: () => close(),
  });
  const actions = h('div', { class: 'dialog-actions' }, [primary]);
  const windowEl = h('div', { class: 'dialog' }, [
    h('div', { class: 'dialog-title' }, [
      h('span', { text: title }),
      ...(modal
        ? []
        : [h('button', { class: 'dock-close', text: '✕', title: 'Close', onclick: () => close() })]),
    ]),
    body,
    h('div', { class: 'dialog-footer' }, [status, actions]),
  ]);
  windowEl.style.width = `${width}px`;
  const overlay = h('div', { class: `overlay${modal ? '' : ' floating'}` }, [windowEl]);
  function close(): void {
    if (closed) {
      return;
    }
    closed = true;
    window.removeEventListener('keydown', onKeyDown, true);
    overlay.remove();
    onClose?.();
  }
  // Escape dismisses the top-most dialog, exactly like pressing its
  // Cancel/close button. Intercepted in the capture phase so the app's own
  // Escape shortcuts do not also fire.
  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') {
      return;
    }
    const overlays = document.querySelectorAll('.overlay');
    if (overlays.length === 0 || overlays[overlays.length - 1] !== overlay) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    close();
  }
  window.addEventListener('keydown', onKeyDown, true);
  document.body.append(overlay);
  return { overlay, body, status, actions, primary, close };
}

// Shows a modal confirmation prompt and resolves true when the confirm button
// is pressed, false when dismissed (Cancel or Escape).
export function confirmDialog(title: string, message: string, confirmLabel = 'OK'): Promise<boolean> {
  return new Promise((resolve) => {
    let confirmed = false;
    const dialog = createDialog(title, 400, 'Cancel', () => resolve(confirmed));
    const confirmButton = h('button', {
      class: 'btn',
      text: confirmLabel,
      onclick: () => {
        confirmed = true;
        dialog.close();
      },
    });
    dialog.body.append(h('div', { class: 'dialog-hint', text: message }));
    // Prepend so the confirm action sits left of Cancel.
    dialog.actions.prepend(confirmButton);
    confirmButton.focus();
  });
}

export interface DockPanel {
  root: HTMLElement;
  body: HTMLElement;
  status: HTMLElement;
  close: () => void;
}

// Creates a non-modal panel docked to the side of the workspace. Unlike
// createDialog, the rest of the UI (including the image) stays interactive.
export function createDockPanel(dock: HTMLElement, title: string, onClose?: () => void): DockPanel {
  let closed = false;
  const status = h('span', { class: 'dock-status' });
  const body = h('div', { class: 'dock-body' });
  const root = h('div', { class: 'dock-panel' }, [
    h('div', { class: 'dock-title' }, [
      h('span', { text: title }),
      h('button', { class: 'dock-close', text: '✕', title: 'Close', onclick: () => close() }),
    ]),
    body,
    h('div', { class: 'dock-footer' }, [status]),
  ]);
  function close(): void {
    if (closed) {
      return;
    }
    closed = true;
    root.remove();
    if (dock.childElementCount === 0) {
      dock.classList.add('hidden');
    }
    onClose?.();
  }
  dock.classList.remove('hidden');
  dock.append(root);
  return { root, body, status, close };
}

export interface Tab {
  label: string;
  content: HTMLElement;
}

export function createTabs(tabs: Tab[]): HTMLElement {
  const bar = h('div', { class: 'tab-bar' });
  const panels = h('div', { class: 'tab-panels' });
  const setActive = (index: number): void => {
    Array.from(bar.children).forEach((child, i) => child.classList.toggle('active', i === index));
    Array.from(panels.children).forEach((child, i) => child.classList.toggle('active', i === index));
  };
  tabs.forEach((tab, index) => {
    bar.append(h('button', { class: 'tab', text: tab.label, onclick: () => setActive(index) }));
    panels.append(h('div', { class: 'tab-panel' }, [tab.content]));
  });
  if (tabs.length > 0) {
    setActive(0);
  }
  return h('div', { class: 'tabs' }, [bar, panels]);
}

export function colorSwatch(color: RGB, className = 'swatch'): HTMLElement {
  const swatch = h('span', { class: className });
  swatch.style.background = `rgb(${color.r}, ${color.g}, ${color.b})`;
  return swatch;
}
