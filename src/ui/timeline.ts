// Animation timeline: a frame strip with playback and export.
//
// Each frame is a full document (its own layers), so the timeline simply
// switches the store's current frame. Playback swaps frames on a timer at the
// chosen frame rate; while playing, canvas editing is disabled (see main.ts).

import { AppContext } from '../context';
import { h } from '../shared/dom';

export interface Timeline {
    root: HTMLElement;
    sync(): void;
    togglePlay(): void;
    stopPlayback(): void;
}

const THUMB_W = 84;
const THUMB_H = 64;
const MIN_FPS = 1;
const MAX_FPS = 60;

export function createTimeline(ctx: AppContext, onLayout: () => void, prepare: () => void): Timeline {
    const { store } = ctx;

    let playing = false;
    let playTimer = 0;
    let playStartFrame = 0;

    const playButton = h('button', {
        class: 'btn anim-control',
        text: '▶ Play',
        title: 'Play / pause the animation (Space)',
        onclick: () => togglePlay(),
    });
    const stopButton = h('button', {
        class: 'btn anim-control',
        text: '■ Stop',
        title: 'Stop playback (Esc)',
        onclick: () => stopPlayback(),
    });

    const fpsInput = h('input', { type: 'number', class: 'anim-fps', value: '12' });
    fpsInput.min = String(MIN_FPS);
    fpsInput.max = String(MAX_FPS);
    fpsInput.title = 'Playback speed in frames per second.';
    fpsInput.addEventListener('change', () => {
        fpsInput.value = String(currentFps());
        if (playing) {
            restartTimer();
        }
    });

    const onionCheckbox = document.createElement('input');
    onionCheckbox.type = 'checkbox';
    onionCheckbox.checked = store.settings.onionSkin;
    onionCheckbox.addEventListener('change', () =>
        store.updateSettings({ onionSkin: onionCheckbox.checked }),
    );

    const onionOpacityInput = h('input', {
        type: 'number',
        class: 'anim-opacity',
        value: String(Math.round(store.settings.onionOpacity * 100)),
    });
    onionOpacityInput.min = '0';
    onionOpacityInput.max = '100';
    onionOpacityInput.title = 'Opacity of the onion skin overlay (0-100%).';
    onionOpacityInput.addEventListener('input', () =>
        store.updateSettings({
            onionOpacity: Math.max(0, Math.min(100, parseInt(onionOpacityInput.value, 10) || 0)) / 100,
        }),
    );

    const duplicateButton = h('button', {
        class: 'btn anim-control',
        text: 'Duplicate Frame',
        title: 'Add a copy of the current frame after it',
        onclick: () => {
            stopPlayback();
            prepare();
            store.addFrame(true);
        },
    });
    const newFrameButton = h('button', {
        class: 'btn anim-control',
        text: 'New Frame',
        title: 'Add a blank frame after the current one',
        onclick: () => {
            stopPlayback();
            prepare();
            store.addFrame(false);
        },
    });
    const deleteButton = h('button', {
        class: 'btn anim-control',
        text: 'Delete',
        title: 'Delete the current frame',
        onclick: () => {
            stopPlayback();
            prepare();
            store.deleteFrame(store.currentFrame);
        },
    });
    const frameLabel = h('span', { class: 'anim-status' });

    const controls = h('div', { class: 'timeline-controls' }, [
        h('div', { class: 'timeline-row' }, [
            playButton,
            stopButton,
            h('span', { class: 'row-label', text: 'FPS' }),
            fpsInput,
            frameLabel,
        ]),
        h('div', { class: 'timeline-row' }, [
            duplicateButton,
            newFrameButton,
            deleteButton,
        ]),
        h('div', { class: 'timeline-row' }, [
            h('label', { class: 'timeline-check', title: 'Overlay the previous frame' }, [
                onionCheckbox,
                h('span', { text: 'Onion skin' }),
            ]),
            h('span', { class: 'row-label', text: 'Opacity' }),
            onionOpacityInput,
            h('span', { class: 'row-label', text: '%' }),
        ]),
    ]);

    const strip = h('div', { class: 'frame-strip' });
    const root = h('div', { class: 'timeline hidden' }, [controls, strip]);

    const thumbs: { item: HTMLElement; canvas: HTMLCanvasElement }[] = [];
    let structureSig = '';
    let lastRevision = -1;
    let lastActive = -1;
    let visible = false;
    const pending = new Set<number>();
    let rafHandle = 0;

    // --- Thumbnails ---

    function scheduleThumb(index: number): void {
        pending.add(index);
        if (rafHandle !== 0) {
            return;
        }
        rafHandle = requestAnimationFrame(() => {
            rafHandle = 0;
            const indices = [...pending];
            pending.clear();
            for (const i of indices) {
                drawThumb(i);
            }
        });
    }

    function drawThumb(index: number): void {
        const entry = thumbs[index];
        if (!entry) {
            return;
        }
        const context = entry.canvas.getContext('2d');
        if (!context) {
            return;
        }
        const w = entry.canvas.width;
        const hgt = entry.canvas.height;
        context.clearRect(0, 0, w, hgt);
        const image = store.frameComposite(index);
        if (!image) {
            return;
        }
        const tmp = document.createElement('canvas');
        tmp.width = image.width;
        tmp.height = image.height;
        tmp.getContext('2d')!.putImageData(image, 0, 0);
        const scale = Math.min(w / image.width, hgt / image.height);
        const dw = Math.max(1, Math.round(image.width * scale));
        const dh = Math.max(1, Math.round(image.height * scale));
        context.imageSmoothingEnabled = false;
        context.drawImage(tmp, Math.floor((w - dw) / 2), Math.floor((hgt - dh) / 2), dw, dh);
    }

    function rebuildStrip(): void {
        strip.replaceChildren();
        thumbs.length = 0;
        for (let i = 0; i < store.frameCount; i++) {
            const index = i;
            const canvas = h('canvas', { class: 'frame-thumb-canvas' });
            canvas.width = THUMB_W;
            canvas.height = THUMB_H;
            const item = h(
                'div',
                {
                    class: 'frame-thumb',
                    title: `Frame ${i + 1}`,
                    onclick: () => {
                        stopPlayback();
                        prepare();
                        store.selectFrame(index);
                    },
                },
                [canvas, h('span', { class: 'frame-number', text: String(i + 1) })],
            );
            item.draggable = true;
            attachDrag(item, index);
            strip.append(item);
            thumbs.push({ item, canvas });
        }
        for (let i = 0; i < thumbs.length; i++) {
            scheduleThumb(i);
        }
    }

    function attachDrag(item: HTMLElement, index: number): void {
        item.addEventListener('dragstart', (event) => {
            event.dataTransfer?.setData('text/plain', String(index));
            if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = 'move';
            }
            item.classList.add('dragging');
        });
        item.addEventListener('dragend', () => item.classList.remove('dragging'));
        item.addEventListener('dragover', (event) => {
            event.preventDefault();
            item.classList.add('drop-target');
        });
        item.addEventListener('dragleave', () => item.classList.remove('drop-target'));
        item.addEventListener('drop', (event) => {
            event.preventDefault();
            item.classList.remove('drop-target');
            const from = Number(event.dataTransfer?.getData('text/plain'));
            if (Number.isNaN(from) || from === index) {
                return;
            }
            stopPlayback();
            prepare();
            store.moveFrame(from, index);
        });
    }

    function signature(): string {
        const parts: string[] = [];
        for (let i = 0; i < store.frameCount; i++) {
            parts.push(String(store.frameId(i)));
        }
        return parts.join(',');
    }

    // --- Playback ---

    function currentFps(): number {
        const value = parseInt(fpsInput.value, 10);
        const fps = Number.isNaN(value) ? 12 : value;
        return Math.max(MIN_FPS, Math.min(MAX_FPS, fps));
    }

    function restartTimer(): void {
        if (playTimer !== 0) {
            window.clearInterval(playTimer);
        }
        playTimer = window.setInterval(() => {
            store.previewFrame((store.currentFrame + 1) % store.frameCount);
        }, Math.round(1000 / currentFps()));
    }

    function togglePlay(): void {
        if (playing) {
            stopPlayback();
        } else {
            startPlayback();
        }
    }

    function startPlayback(): void {
        if (playing || !store.settings.animationMode || store.frameCount < 2) {
            return;
        }
        prepare();
        playing = true;
        playStartFrame = store.currentFrame;
        store.setPlaying(true);
        restartTimer();
        sync();
    }

    function stopPlayback(): void {
        if (!playing) {
            return;
        }
        playing = false;
        if (playTimer !== 0) {
            window.clearInterval(playTimer);
            playTimer = 0;
        }
        store.setPlaying(false);
        store.selectFrame(playStartFrame);
        sync();
    }

    // --- Sync ---

    function sync(): void {
        const shouldShow = store.settings.animationMode && store.frameCount > 0 && store.width > 0;
        if (shouldShow !== visible) {
            visible = shouldShow;
            root.classList.toggle('hidden', !shouldShow);
            onLayout();
        }
        if (!shouldShow) {
            if (playing) {
                stopPlayback();
            }
            return;
        }

        const sig = signature();
        if (sig !== structureSig) {
            structureSig = sig;
            rebuildStrip();
            lastRevision = store.revision;
            lastActive = store.currentFrame;
        }

        if (store.revision !== lastRevision) {
            lastRevision = store.revision;
            scheduleThumb(store.currentFrame);
        }
        if (lastActive !== store.currentFrame) {
            if (lastActive >= 0) {
                scheduleThumb(lastActive);
            }
            lastActive = store.currentFrame;
        }

        for (let i = 0; i < thumbs.length; i++) {
            thumbs[i].item.classList.toggle('active', i === store.currentFrame);
        }

        playButton.textContent = playing ? '⏸ Pause' : '▶ Play';
        playButton.disabled = !playing && store.frameCount < 2;
        deleteButton.disabled = store.frameCount <= 1;
        stopButton.disabled = !playing;
        frameLabel.textContent = `Frame ${store.currentFrame + 1} / ${store.frameCount}`;

        onionCheckbox.checked = store.settings.onionSkin;
        if (document.activeElement !== onionOpacityInput) {
            onionOpacityInput.value = String(Math.round(store.settings.onionOpacity * 100));
        }
        onionOpacityInput.disabled = !store.settings.onionSkin;
        onionCheckbox.disabled = store.currentFrame === 0;
    }

    return { root, sync, togglePlay, stopPlayback };
}
