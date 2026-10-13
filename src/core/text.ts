// Text stamping for the Text tool.

import { RGB } from '../shared/color';

export interface TextStyle {
    size: number;
    font: string;
    bold: boolean;
    italic: boolean;
    color: RGB;
}

// Draws the given text onto a copy of the layer image at document position
// (x, y) using the top-left as the anchor. Returns the new layer image.
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
    context.font = `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.size}px ${style.font}`;
    context.fillStyle = `rgb(${style.color.r}, ${style.color.g}, ${style.color.b})`;
    context.textBaseline = 'top';
    const lines = text.split('\n');
    const lineHeight = style.size * 1.2;
    for (let i = 0; i < lines.length; i++) {
        context.fillText(lines[i], x - offsetX, y - offsetY + i * lineHeight);
    }
    return context.getImageData(0, 0, docWidth, docHeight);
}
