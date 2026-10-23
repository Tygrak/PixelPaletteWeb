// Open File dialog: choose a file from disk, drop one onto the drop zone,
// paste an image from the clipboard, or pick an auto-saved recent file.

import { createDialog, h } from '../shared/dom';
import { clipboardImageFile, imageDataFromBlob, pickFile } from '../shared/files';
import { PROJECT_EXTENSION } from '../core/project';
import { listRecent, RecentEntry } from '../core/recentFiles';
import { createRecentTile } from './startScreen';

export type OpenFileChoice = { file: File } | { image: ImageData } | { recent: RecentEntry };

export function openFileDialog(): Promise<OpenFileChoice | null> {
    return new Promise((resolve) => {
        let done = false;
        const finish = (choice: OpenFileChoice | null): void => {
            if (done) {
                return;
            }
            done = true;
            resolve(choice);
        };

        const dialog = createDialog('Open File', 480, 'Cancel', () => {
            window.removeEventListener('paste', onPaste, true);
            finish(null);
        });

        const dropZone = h('div', {
            class: 'drop-zone',
            text: `Drag and drop an image or ${PROJECT_EXTENSION} file here`,
        });
        dropZone.addEventListener('dragover', (event) => {
            event.preventDefault();
            dropZone.classList.add('dragover');
        });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', (event) => {
            event.preventDefault();
            // Stop the window-level drop handler from also opening the file.
            event.stopPropagation();
            dropZone.classList.remove('dragover');
            const file = event.dataTransfer?.files?.[0];
            if (file) {
                finish({ file });
                dialog.close();
            }
        });

        const recentList = h('div', { class: 'recent-tile-list' });
        const recentSection = h('div', { class: 'recent-tiles hidden' }, [
            h('div', { class: 'recent-tiles-title', text: 'Recent files' }),
            recentList,
        ]);
        void listRecent().then((entries) => {
            if (done) {
                return;
            }
            recentSection.classList.toggle('hidden', entries.length === 0);
            for (const entry of entries) {
                recentList.append(
                    createRecentTile(entry, (chosen) => {
                        finish({ recent: chosen });
                        dialog.close();
                    }),
                );
            }
        });

        // Pasting while the dialog is open opens the clipboard image instead of
        // adding it as a layer to the current document.
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

        const browseButton = h('button', {
            class: 'btn',
            text: 'Choose File...',
            title: 'Open an image or project file from your computer',
            onclick: async () => {
                const file = await pickFile(
                    `image/png,image/jpeg,image/bmp,image/gif,image/webp,image/*,${PROJECT_EXTENSION}`,
                );
                if (file) {
                    finish({ file });
                    dialog.close();
                }
            },
        });

        dialog.body.append(
            h('div', { class: 'tab-content' }, [
                dropZone,
                h('div', { class: 'dialog-hint', text: 'Or press Ctrl+V to open an image from the clipboard.' }),
                recentSection,
            ]),
        );
        // "Choose File..." sits next to Cancel.
        dialog.actions.prepend(browseButton);
    });
}
