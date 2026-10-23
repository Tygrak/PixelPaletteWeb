// Client-side file helpers. Everything stays local in the browser.

function decodeImageSource(src: string): Promise<ImageData | null> {
    return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(image, 0, 0);
            resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
        };
        image.onerror = () => resolve(null);
        image.src = src;
    });
}

export function imageDataFromBlob(blob: Blob): Promise<ImageData | null> {
    const url = URL.createObjectURL(blob);
    return decodeImageSource(url).then((image) => {
        URL.revokeObjectURL(url);
        return image;
    });
}

// Encodes pixels as a PNG data URL. Synchronous on purpose: the recent-files
// auto-save also runs while the page is being closed (pagehide), where an
// asynchronous toBlob callback would not survive.
export function imageDataToPngDataUrl(image: ImageData): string {
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext('2d')!.putImageData(image, 0, 0);
    return canvas.toDataURL('image/png');
}

// Opens the browser's file picker and resolves with the chosen file (or never,
// when the picker is dismissed without a selection, like loadImageFile).
export function pickFile(accept: string): Promise<File | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.onchange = () => resolve(input.files?.[0] ?? null);
        input.click();
    });
}

export function loadImageFile(): Promise<ImageData | null> {
    return pickFile('image/png,image/jpeg,image/bmp,image/gif,image/webp,image/*').then((file) =>
        file ? imageDataFromBlob(file) : null,
    );
}

// First image file pasted onto a clipboard event, if any.
export function clipboardImageFile(event: ClipboardEvent): File | null {
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

export function saveImageFile(img: ImageData, filename = 'image.png'): void {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d')!.putImageData(img, 0, 0);
    canvas.toBlob((blob) => {
        if (blob) {
            downloadBlob(blob, filename);
        }
    }, 'image/png');
}

export function loadTextFile(accept = '.palette,.txt,text/plain'): Promise<{ name: string; text: string } | null> {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) {
                resolve(null);
                return;
            }
            const reader = new FileReader();
            reader.onload = () => resolve({ name: file.name, text: String(reader.result ?? '') });
            reader.onerror = () => resolve(null);
            reader.readAsText(file);
        };
        input.click();
    });
}

export function saveTextFile(text: string, filename: string): void {
    downloadBlob(new Blob([text], { type: 'text/plain' }), filename);
}

export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}
