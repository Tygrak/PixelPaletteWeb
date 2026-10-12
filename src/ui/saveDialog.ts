// Save dialog, shared by the toolbar Save button in both normal and animation
// mode. Exports the current frame, a sprite sheet, or separate images, and
// remembers the last used options.

import { createDialog, h } from '../dom';
import { saveImageFile } from '../files';
import type { SaveFormat } from '../settings';
import type { Store } from '../store';

// Strips a trailing .png and any characters that are unsafe in file names.
function sanitizeName(raw: string): string {
  const withoutExtension = raw.trim().replace(/\.png$/i, '');
  const cleaned = withoutExtension.replace(/[\\/:*?"<>|]/g, '_').trim();
  return cleaned === '' ? 'image' : cleaned;
}

export function openSaveDialog(store: Store): void {
  const frameCount = store.frameCount;
  const multiFrame = frameCount > 1;
  const frameW = store.width;
  const frameH = store.height;

  const dialog = createDialog('Save Image', 400, 'Cancel');

  const formatSelect = h('select', { class: 'select' }, [
    h('option', { value: 'current', text: 'Current frame' }),
    h('option', { value: 'grid', text: 'Sprite sheet (grid)' }),
    h('option', { value: 'separate', text: 'Separate images' }),
  ]);
  formatSelect.title = 'What to export: the current frame, a combined sprite sheet, or one file per frame.';
  // Grid/separate only make sense with more than one frame.
  (formatSelect.children[1] as HTMLOptionElement).disabled = !multiFrame;
  (formatSelect.children[2] as HTMLOptionElement).disabled = !multiFrame;
  const remembered = store.settings.saveFormat;
  formatSelect.value = multiFrame || remembered === 'current' ? remembered : 'current';

  const autoColumns = Math.max(1, Math.ceil(Math.sqrt(frameCount)));
  const columnsInput = h('input', {
    type: 'number',
    value: String(store.settings.saveColumns > 0 ? store.settings.saveColumns : autoColumns),
  });
  columnsInput.min = '1';
  columnsInput.max = String(Math.max(1, frameCount));
  columnsInput.style.width = '80px';
  columnsInput.title = 'Number of columns used to arrange frames in the sprite sheet.';

  const nameInput = h('input', { type: 'text', value: store.settings.saveFileName });
  nameInput.style.width = '180px';
  nameInput.title = 'Base file name used for the exported file(s), without the extension.';

  const columnsRow = h('div', { class: 'row' }, [
    h('span', { class: 'row-label', text: 'Columns' }),
    h('div', { class: 'row-controls' }, [columnsInput]),
  ]);

  const hint = h('div', { class: 'dialog-hint' });

  const updateHint = (): void => {
    const name = sanitizeName(nameInput.value);
    const format = formatSelect.value as SaveFormat;
    if (format === 'separate') {
      hint.textContent = `Saves ${frameCount} file(s): ${name}_001.png …`;
    } else {
      const cols = Math.max(1, parseInt(columnsInput.value, 10) || 1);
      hint.textContent =
        format === 'grid'
          ? `${frameCount} frame(s) at ${frameW}×${frameH}, ${cols} column(s), ${name}.png`
          : `Current frame at ${frameW}×${frameH}, ${name}.png`;
    }
  };

  const updateVisibility = (): void => {
    columnsRow.style.display = formatSelect.value === 'grid' ? 'flex' : 'none';
    updateHint();
  };
  formatSelect.addEventListener('change', updateVisibility);
  columnsInput.addEventListener('input', updateHint);
  nameInput.addEventListener('input', updateHint);

  const saveButton = h('button', {
    class: 'btn',
    text: 'Save',
    onclick: () => {
      const format = formatSelect.value as SaveFormat;
      const name = sanitizeName(nameInput.value);
      store.updateSettings({
        saveFormat: format,
        saveColumns: Math.max(1, parseInt(columnsInput.value, 10) || 1),
        saveFileName: name,
      });
      dialog.close();
      if (format === 'separate') {
        saveSeparate(store, name);
      } else if (format === 'grid') {
        saveGrid(store, name, parseInt(columnsInput.value, 10) || 1);
      } else {
        saveCurrent(store, name);
      }
    },
  });

  dialog.body.append(
    h('div', { class: 'tab-content' }, [
      h('div', { class: 'row' }, [
        h('span', { class: 'row-label', text: 'Save' }),
        h('div', { class: 'row-controls' }, [formatSelect]),
      ]),
      columnsRow,
      h('div', { class: 'row' }, [
        h('span', { class: 'row-label', text: 'File name' }),
        h('div', { class: 'row-controls' }, [nameInput, h('span', { class: 'row-label', text: '.png' })]),
      ]),
      hint,
    ]),
  );
  // Save sits in the footer left of Cancel so both actions share one row.
  dialog.actions.prepend(saveButton);
  updateVisibility();
  nameInput.focus();
  nameInput.select();
}

function saveCurrent(store: Store, name: string): void {
  const image = store.frameComposite(store.currentFrame) ?? store.current;
  if (image) {
    saveImageFile(image, `${name}.png`);
  }
}

function saveGrid(store: Store, name: string, columns: number): void {
  const n = store.frameCount;
  const frameW = store.width;
  const frameH = store.height;
  if (n === 0 || frameW === 0 || frameH === 0) {
    return;
  }
  const cols = Math.max(1, Math.min(n, Math.round(columns)));
  const rows = Math.ceil(n / cols);
  const sheet = document.createElement('canvas');
  sheet.width = cols * frameW;
  sheet.height = rows * frameH;
  const context = sheet.getContext('2d');
  if (!context) {
    return;
  }
  const cell = document.createElement('canvas');
  cell.width = frameW;
  cell.height = frameH;
  const cellContext = cell.getContext('2d')!;
  for (let i = 0; i < n; i++) {
    const image = store.frameComposite(i);
    if (!image) {
      continue;
    }
    cellContext.clearRect(0, 0, frameW, frameH);
    cellContext.putImageData(image, 0, 0);
    context.drawImage(cell, (i % cols) * frameW, Math.floor(i / cols) * frameH);
  }
  saveImageFile(context.getImageData(0, 0, sheet.width, sheet.height), `${name}.png`);
}

function saveSeparate(store: Store, name: string): void {
  const n = store.frameCount;
  for (let i = 0; i < n; i++) {
    const image = store.frameComposite(i);
    if (!image) {
      continue;
    }
    const filename = `${name}_${String(i + 1).padStart(3, '0')}.png`;
    window.setTimeout(() => saveImageFile(image, filename), i * 120);
  }
}
