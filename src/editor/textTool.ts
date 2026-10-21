import { store } from '../appStore';
import { drawText } from '../core/text';

// On-canvas text editing (Text tool): typed directly on the canvas, committed
// on Enter. The owning module supplies the hooks for applying the finished
// pixels and for refreshing the overlay (caret blink included).

interface TextToolHooks {
    applyImage(image: ImageData): void;
    redraw(): void;
}

let hooks: TextToolHooks | null = null;

export function initTextTool(next: TextToolHooks): void {
    hooks = next;
}

export interface TextEditing {
    x: number;
    y: number;
    content: string;
}

let editing: TextEditing | null = null;
let caretOn = true;
let caretTimer = 0;

export function isTextEditing(): boolean {
    return editing !== null;
}

export function getTextEditing(): TextEditing | null {
    return editing;
}

export function isCaretOn(): boolean {
    return caretOn;
}

function startCaretBlink(): void {
    stopCaretBlink();
    caretOn = true;
    caretTimer = window.setInterval(() => {
        caretOn = !caretOn;
        hooks?.redraw();
    }, 500);
}

function stopCaretBlink(): void {
    if (caretTimer) {
        window.clearInterval(caretTimer);
        caretTimer = 0;
    }
}

export function textFontString(): string {
    return `${store.textItalic ? 'italic ' : ''}${store.textBold ? 'bold ' : ''}${store.textSize}px ${store.textFont}`;
}

export function startText(x: number, y: number): void {
    if (editing) {
        commitText();
    }
    editing = { x, y, content: '' };
    startCaretBlink();
    hooks?.redraw();
}

export function typeText(char: string): void {
    if (!editing) {
        return;
    }
    editing.content += char;
    hooks?.redraw();
}

export function backspaceText(): void {
    if (!editing) {
        return;
    }
    editing.content = editing.content.slice(0, -1);
    hooks?.redraw();
}

// Moves the text being written (arrow keys while editing). The preview, the
// caret and the committed position all follow.
export function nudgeText(dx: number, dy: number): void {
    if (!editing) {
        return;
    }
    editing.x += dx;
    editing.y += dy;
    hooks?.redraw();
}

export function commitText(): void {
    if (!editing) {
        return;
    }
    const { x, y, content } = editing;
    editing = null;
    stopCaretBlink();
    const layer = store.activeLayer;
    if (content.trim() && layer) {
        const updated = drawText(
            layer.image,
            store.width,
            store.height,
            layer.offsetX,
            layer.offsetY,
            content,
            x,
            y,
            {
                size: store.textSize,
                font: store.textFont,
                bold: store.textBold,
                italic: store.textItalic,
                color: store.paintColor,
                shadow: store.textShadow,
            },
        );
        hooks?.applyImage(updated);
    }
    hooks?.redraw();
}

export function cancelText(): void {
    if (!editing) {
        return;
    }
    editing = null;
    stopCaretBlink();
    hooks?.redraw();
}
