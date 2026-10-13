import { RGB } from './shared/color';
import { Store } from './core/store';

export interface AppContext {
    store: Store;
    dock: HTMLElement;
    // Opens the color picker. When `onChange` is given the picker applies every
    // change immediately (live picker) instead of only on Ok.
    selectColor(initial?: RGB, onChange?: (color: RGB) => void): Promise<RGB>;
    applyImage(img: ImageData): void;
    runTask<T>(status: string, task: () => T): Promise<T>;
    openImageFile(): Promise<ImageData | null>;
    saveImage(img: ImageData): void;
    copyText(text: string): void;
}
