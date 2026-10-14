// Minimal animated GIF encoder (GIF89a): a global color table, one full-frame
// image per frame with a transparent index and "restore to background"
// disposal, and infinite looping via the Netscape extension. No dependencies.
//
// The LZW coder follows the classic GIF encoder behaviour: the code size grows
// right after a dictionary entry is added (matching how decoders grow theirs
// one code behind), and the table is cleared when it reaches 4096 entries.

import { RGB } from './color';

export interface GifFrameData {
    // One palette index per pixel, row-major.
    pixels: Uint8Array;
    // Frame duration in hundredths of a second (GIF's unit).
    delayCs: number;
}

function pushU16(bytes: number[], value: number): void {
    bytes.push(value & 0xff, (value >> 8) & 0xff);
}

function lzwEncode(minCodeSize: number, pixels: Uint8Array): Uint8Array {
    const clearCode = 1 << minCodeSize;
    const endCode = clearCode + 1;
    const maxMaxCode = 1 << 12;
    let codeSize = minCodeSize + 1;
    let maxCode = (1 << codeSize) - 1;
    let nextCode = endCode + 1;
    const dict = new Map<number, number>();

    let out = new Uint8Array(Math.max(64, pixels.length >> 1));
    let outLength = 0;
    const pushByte = (byte: number): void => {
        if (outLength === out.length) {
            const grown = new Uint8Array(out.length * 2);
            grown.set(out);
            out = grown;
        }
        out[outLength++] = byte;
    };

    let bitBuffer = 0;
    let bitCount = 0;
    const write = (code: number): void => {
        bitBuffer |= code << bitCount;
        bitCount += codeSize;
        while (bitCount >= 8) {
            pushByte(bitBuffer & 0xff);
            bitBuffer >>>= 8;
            bitCount -= 8;
        }
        // Grow the code size for the next code once the table has outgrown it.
        // This must happen after the code is written: decoders add their table
        // entry one code behind, so they grow at the same point.
        if (nextCode > maxCode && codeSize < 12) {
            codeSize++;
            maxCode = (1 << codeSize) - 1;
        }
    };

    write(clearCode);
    let prefix = pixels.length > 0 ? pixels[0] : 0;
    for (let i = 1; i < pixels.length; i++) {
        const next = pixels[i];
        const key = (prefix << 8) | next;
        const found = dict.get(key);
        if (found !== undefined) {
            prefix = found;
            continue;
        }
        write(prefix);
        if (nextCode < maxMaxCode) {
            dict.set(key, nextCode);
            nextCode++;
        } else {
            // The dictionary is full: reset it (decoders reset on the clear).
            write(clearCode);
            dict.clear();
            codeSize = minCodeSize + 1;
            maxCode = (1 << codeSize) - 1;
            nextCode = endCode + 1;
        }
        prefix = next;
    }
    write(prefix);
    write(endCode);
    if (bitCount > 0) {
        pushByte(bitBuffer & 0xff);
    }
    return out.subarray(0, outLength);
}

export function encodeGif(
    width: number,
    height: number,
    palette: RGB[],
    transparentIndex: number | null,
    frames: GifFrameData[],
): Blob {
    const entries = palette.length + (transparentIndex !== null ? 1 : 0);
    let sizeBits = 1;
    while ((1 << sizeBits) < entries) {
        sizeBits++;
    }
    sizeBits = Math.max(1, Math.min(8, sizeBits));
    const tableSize = 1 << sizeBits;
    const minCodeSize = Math.max(2, sizeBits);

    const parts: BlobPart[] = [];
    const meta: number[] = [];
    for (const ch of 'GIF89a') {
        meta.push(ch.charCodeAt(0));
    }
    // Logical screen descriptor.
    pushU16(meta, width);
    pushU16(meta, height);
    meta.push(0x80 | 0x70 | (sizeBits - 1)); // global table, 8-bit color resolution
    meta.push(transparentIndex ?? 0); // background color index
    meta.push(0); // pixel aspect ratio
    // Global color table, padded up to the power-of-two size.
    for (let i = 0; i < tableSize; i++) {
        const color = palette[i];
        meta.push(color?.r ?? 0, color?.g ?? 0, color?.b ?? 0);
    }
    // Netscape looping extension: loop forever.
    meta.push(0x21, 0xff, 0x0b);
    for (const ch of 'NETSCAPE2.0') {
        meta.push(ch.charCodeAt(0));
    }
    meta.push(0x03, 0x01, 0x00, 0x00, 0x00);
    parts.push(Uint8Array.from(meta));

    for (const frame of frames) {
        const header: number[] = [];
        // Graphic control extension.
        header.push(0x21, 0xf9, 0x04);
        // Disposal 2 (restore to background) so transparent pixels never show
        // the previous frame, plus the transparent flag.
        header.push((2 << 2) | (transparentIndex !== null ? 0x01 : 0x00));
        pushU16(header, Math.max(1, Math.round(frame.delayCs)));
        header.push(transparentIndex ?? 0, 0x00);
        // Image descriptor: full frame, no local table, no interlace.
        header.push(0x2c);
        pushU16(header, 0);
        pushU16(header, 0);
        pushU16(header, width);
        pushU16(header, height);
        header.push(0x00);
        header.push(minCodeSize);
        parts.push(Uint8Array.from(header));

        // LZW data in sub-blocks of at most 255 bytes.
        const compressed = lzwEncode(minCodeSize, frame.pixels);
        const blockCount = Math.ceil(compressed.length / 255);
        const blocked = new Uint8Array(compressed.length + blockCount + 1);
        let position = 0;
        for (let offset = 0; offset < compressed.length; offset += 255) {
            const length = Math.min(255, compressed.length - offset);
            blocked[position++] = length;
            blocked.set(compressed.subarray(offset, offset + length), position);
            position += length;
        }
        blocked[position++] = 0x00;
        parts.push(blocked);
    }
    parts.push(new Uint8Array([0x3b])); // trailer
    return new Blob(parts, { type: 'image/gif' });
}
