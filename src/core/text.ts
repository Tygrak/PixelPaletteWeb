// Text stamping for the Text tool.

import { RGB } from '../shared/color';
import { shadowSilhouette, ShadowOptions } from './shadow';

export interface TextStyle {
    size: number;
    font: string;
    bold: boolean;
    italic: boolean;
    color: RGB;
    // Cast a soft drop shadow behind the text.
    shadow: boolean;
}

// Shadow used by the Text tool's Shadow option: dark, soft and slightly
// offset, scaled with the text size.
export function textShadowOptions(size: number): ShadowOptions {
    const scale = Math.max(8, size);
    return {
        color: { r: 0, g: 0, b: 0 },
        offsetX: Math.max(2, Math.round(scale * 0.07)),
        offsetY: Math.max(2, Math.round(scale * 0.07)),
        blur: Math.max(1, Math.round(scale * 0.05)),
        opacity: 0.6,
    };
}

function fontString(style: TextStyle): string {
    return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.size}px ${style.font}`;
}

// Rasterizes just the text (white on transparent) as the alpha source for a
// drop shadow.
function renderTextMask(
    docWidth: number,
    docHeight: number,
    offsetX: number,
    offsetY: number,
    text: string,
    x: number,
    y: number,
    style: TextStyle,
): ImageData {
    const canvas = document.createElement('canvas');
    canvas.width = docWidth;
    canvas.height = docHeight;
    const context = canvas.getContext('2d')!;
    context.font = fontString(style);
    context.fillStyle = '#ffffff';
    context.textBaseline = 'top';
    const lines = text.split('\n');
    const lineHeight = style.size * 1.2;
    for (let i = 0; i < lines.length; i++) {
        context.fillText(lines[i], x - offsetX, y - offsetY + i * lineHeight);
    }
    return context.getImageData(0, 0, docWidth, docHeight);
}

// Draws the given text onto a copy of the layer image at document position
// (x, y) using the top-left as the anchor. With `style.shadow` a soft drop
// shadow is cast over the existing layer pixels behind the new text.
export function drawText(
    layerImage: ImageData,
    docWidth: number,
    docHeight: number,
    offsetX: number,
    offsetY: number,
    text: string,
    x: number,
    y: number,
    style: TextStyle,
): ImageData {
    const canvas = document.createElement('canvas');
    canvas.width = docWidth;
    canvas.height = docHeight;
    const context = canvas.getContext('2d')!;
    context.putImageData(layerImage, 0, 0);
    if (style.shadow) {
        const mask = renderTextMask(docWidth, docHeight, offsetX, offsetY, text, x, y, style);
        const shadow = shadowSilhouette(mask, textShadowOptions(style.size));
        const shadowCanvas = document.createElement('canvas');
        shadowCanvas.width = docWidth;
        shadowCanvas.height = docHeight;
        shadowCanvas.getContext('2d')!.putImageData(shadow, 0, 0);
        context.drawImage(shadowCanvas, 0, 0);
    }
    context.font = fontString(style);
    context.fillStyle = `rgb(${style.color.r}, ${style.color.g}, ${style.color.b})`;
    context.textBaseline = 'top';
    const lines = text.split('\n');
    const lineHeight = style.size * 1.2;
    for (let i = 0; i < lines.length; i++) {
        context.fillText(lines[i], x - offsetX, y - offsetY + i * lineHeight);
    }
    return context.getImageData(0, 0, docWidth, docHeight);
}
