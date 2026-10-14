// Save dialog, shared by the toolbar Save button in both normal and animation
// mode. Saves the whole project (all layers/frames) as a downloaded file or to
// browser storage, or exports the current frame, a sprite sheet, separate
// images, or a looping animated GIF, and remembers the last used options.
// Every manual save also refreshes the recent-files auto-save.

import { createDialog, h } from '../shared/dom';
import { downloadBlob, saveImageFile } from '../shared/files';
import { exportAnimationGif } from '../core/gifExport';
import { downloadProjectFile, encodeProject, PROJECT_EXTENSION } from '../core/project';
import { autoSaveRecent, documentName } from '../core/recentFiles';
import type { SaveFormat } from '../core/settings';
import type { Store } from '../core/store';

// Strips a trailing project/png/gif extension and any characters that are
// unsafe in file names.
function sanitizeName(raw: string): string {
    const withoutExtension = raw.trim().replace(/\.(png|pixelpalette|gif)$/i, '');
    const cleaned = withoutExtension.replace(/[\\/:*?"<>|]/g, '_').trim();
    return cleaned === '' ? 'image' : cleaned;
}

// Shows a status message in the toolbar and clears it again after a few
// seconds (unless something else replaced it in the meantime).
function flashStatus(store: Store, message: string, ms = 4000): void {
    store.setStatus(message);
    window.setTimeout(() => {
        if (store.status === message) {
            store.setStatus('');
        }
    }, ms);
}

export function openSaveDialog(store: Store, fps: number): void {
    const frameCount = store.frameCount;
    const multiFrame = frameCount > 1;
    // Animated GIF export needs the timeline (animation mode) and a sequence.
    const canGif = store.settings.animationMode && multiFrame;
    const frameW = store.width;
    const frameH = store.height;

    const dialog = createDialog('Save File', 400, 'Cancel');

    const projectOption = h('option', { value: 'project', text: `Project file (${PROJECT_EXTENSION})` });
    const storageOption = h('option', { value: 'storage', text: 'Browser storage (no download)' });
    const currentOption = h('option', { value: 'current', text: 'Current frame' });
    const gridOption = h('option', { value: 'grid', text: 'Sprite sheet (grid)' });
    const separateOption = h('option', { value: 'separate', text: 'Separate images' });
    const gifOption = h('option', { value: 'gif', text: 'Animated GIF' });
    // Grid/separate/gif only make sense with more than one frame.
    gridOption.disabled = !multiFrame;
    separateOption.disabled = !multiFrame;
    gifOption.disabled = !canGif;
    const formatSelect = h('select', { class: 'select' }, [
        projectOption,
        storageOption,
        currentOption,
        gridOption,
        separateOption,
        gifOption,
    ]);
    formatSelect.title =
        'Project keeps every layer and frame so you can reopen and continue later; browser storage keeps a copy in the recent files without downloading anything; animated GIF exports the frames at the timeline FPS; the other formats export flattened PNG image(s).';
    const remembered = store.settings.saveFormat;
    // Project and storage work for any document; the rest need several frames
    // (and the GIF also needs animation mode).
    formatSelect.value =
        remembered === 'project' ||
        remembered === 'storage' ||
        remembered === 'current' ||
        (multiFrame && (remembered === 'grid' || remembered === 'separate')) ||
        (canGif && remembered === 'gif')
            ? remembered
            : 'current';

    const autoColumns = Math.max(1, Math.ceil(Math.sqrt(frameCount)));
    const columnsInput = h('input', {
        type: 'number',
        value: String(store.settings.saveColumns > 0 ? store.settings.saveColumns : autoColumns),
    });
    columnsInput.min = '1';
    columnsInput.max = String(Math.max(1, frameCount));
    columnsInput.style.width = '80px';
    columnsInput.title = 'Number of columns used to arrange frames in the sprite sheet.';

    // Pre-filled with the document's own name; new documents start as
    // "untitled" and only gain a name when saved with one.
    const nameInput = h('input', { type: 'text', value: documentName() });
    nameInput.style.width = '180px';
    nameInput.title = 'Name used for the exported file(s) and the recent-files entry, without the extension.';

    // Shows the extension the chosen format will actually produce.
    const extensionLabel = h('span', { class: 'row-label', text: '.png' });

    const columnsRow = h('div', { class: 'row' }, [
        h('span', { class: 'row-label', text: 'Columns' }),
        h('div', { class: 'row-controls' }, [columnsInput]),
    ]);

    const hint = h('div', { class: 'dialog-hint' });

    const updateHint = (): void => {
        const name = sanitizeName(nameInput.value);
        const format = formatSelect.value as SaveFormat;
        if (format === 'project') {
            hint.textContent = `Project with all layers, ${frameCount} frame(s) at ${frameW}×${frameH}, ${name}${PROJECT_EXTENSION}`;
        } else if (format === 'storage') {
            hint.textContent = `Keeps a copy in this browser's recent files as "${name}"; no file is downloaded.`;
        } else if (format === 'separate') {
            hint.textContent = `Saves ${frameCount} file(s): ${name}_001.png …`;
        } else if (format === 'gif') {
            hint.textContent = `Looping animated GIF, ${frameCount} frames at ${frameW}×${frameH}, ${Math.round(fps)} fps, ${name}.gif`;
        } else {
            const cols = Math.max(1, parseInt(columnsInput.value, 10) || 1);
            hint.textContent =
                format === 'grid'
                    ? `${frameCount} frame(s) at ${frameW}×${frameH}, ${cols} column(s), ${name}.png`
                    : `Current frame at ${frameW}×${frameH}, ${name}.png`;
        }
    };

    const updateVisibility = (): void => {
        const format = formatSelect.value as SaveFormat;
        columnsRow.style.display = format === 'grid' ? 'flex' : 'none';
        extensionLabel.style.display = format === 'storage' ? 'none' : '';
        extensionLabel.textContent =
            format === 'project' ? PROJECT_EXTENSION : format === 'gif' ? '.gif' : '.png';
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
            });
            dialog.close();
            if (format === 'storage') {
                // Keep a project copy in the recent files without downloading.
                const blob = encodeProject(store);
                void autoSaveRecent(store, { force: true, name, blob, manual: true }).then((result) => {
                    if (result === 'saved') {
                        flashStatus(store, 'Saved to browser storage');
                    } else if (result === 'failed') {
                        store.setStatus('Could not save to browser storage');
                    }
                    // 'skipped-too-big' already set its own status message.
                });
                return;
            }
            if (format === 'project') {
                // Encode once and reuse the result for the downloaded file and
                // the recent-files snapshot.
                const blob = encodeProject(store);
                downloadProjectFile(blob, name);
                void autoSaveRecent(store, { force: true, name, blob });
                return;
            }
            if (format === 'separate') {
                saveSeparate(store, name);
            } else if (format === 'grid') {
                saveGrid(store, name, parseInt(columnsInput.value, 10) || 1);
            } else if (format === 'gif') {
                saveGif(store, name, fps);
            } else {
                saveCurrent(store, name);
            }
            // Keeping a recent copy on every manual save is part of the
            // auto-save feature (no-op while it is disabled in Settings).
            void autoSaveRecent(store, { force: true, name });
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
                h('div', { class: 'row-controls' }, [nameInput, extensionLabel]),
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

function saveGif(store: Store, name: string, fps: number): void {
    store.setStatus('Exporting GIF...');
    // Let the dialog close and the status paint before the (synchronous)
    // encode runs.
    window.setTimeout(() => {
        const blob = exportAnimationGif(store, fps);
        if (!blob) {
            store.setStatus('Could not export the animation');
            return;
        }
        downloadBlob(blob, `${name}.gif`);
        store.setStatus('');
    }, 50);
}
