// New File dialog: choose the size of a blank document, or press Ctrl+V to
// start from an image in the clipboard. Replaces the old confirmation prompt,
// which the dialog itself now provides.

import { createDialog, h, num, numeric, row } from '../dom';
import { imageDataFromBlob } from '../files';
import type { Store } from '../store';

export type NewFileChoice = { image: ImageData } | { width: number; height: number };

function clipboardImageFile(event: ClipboardEvent): File | null {
  const items = event.clipboardData?.items;
  if (!items) {
    return null;
  }
  for (let i = 0; i < items.length; i++) {
    if (items[i].type.startsWith('image/')) {
      const file = items[i].getAsFile();
      if (file) {
        return file;
      }
    }
  }
  return null;
}

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
    widthInput.title = 'Width of the new image in pixels.';
    heightInput.title = 'Height of the new image in pixels.';
    const hint = h('div', { class: 'dialog-hint', text: 'Or press Ctrl+V to start from a clipboard image.' });

    const dialog = createDialog('New File', 380, 'Cancel', () => {
      window.removeEventListener('paste', onPaste, true);
      finish(null);
    });

    const createButton = h('button', {
      class: 'btn',
      text: 'New File',
      onclick: () => {
        finish({ width: Math.max(1, Math.round(num(widthInput))), height: Math.max(1, Math.round(num(heightInput))) });
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
          finish({ image });
          dialog.close();
        }
      });
    };
    window.addEventListener('paste', onPaste, true);

    dialog.body.append(
      h('div', { class: 'tab-content' }, [row('Width (px):', widthInput), row('Height (px):', heightInput), hint]),
    );
    // "New File" sits next to Cancel.
    dialog.actions.prepend(createButton);
    widthInput.focus();
    widthInput.select();
  });
}
