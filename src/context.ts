import { RGB } from './color';
import { Store } from './store';

export interface AppContext {
  store: Store;
  dock: HTMLElement;
  selectColor(initial?: RGB): Promise<RGB>;
  applyImage(img: ImageData): void;
  runTask<T>(status: string, task: () => T): Promise<T>;
  openImageFile(): Promise<ImageData | null>;
  saveImage(img: ImageData): void;
  copyText(text: string): void;
}
