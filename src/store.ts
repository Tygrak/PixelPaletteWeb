import { rgb, RGB } from './color';

type Listener = () => void;

// Mirrors the state held by MainWindow + PaletteWindow in the original app.
export class Store {
  initial: ImageData | null = null;
  current: ImageData | null = null;

  private undoStack: ImageData[] = [];
  private redoStack: ImageData[] = [];

  palette: RGB[] = [rgb(0, 0, 0), rgb(255, 255, 255)];

  working = false;
  status = '';

  private listeners: Listener[] = [];

  onChange(listener: Listener): () => void {
    this.listeners.push(listener);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index >= 0) {
        this.listeners.splice(index, 1);
      }
    };
  }

  emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  openImage(img: ImageData): void {
    this.initial = img;
    this.current = img;
    this.undoStack = [];
    this.redoStack = [];
    this.emit();
  }

  changeMainImage(img: ImageData): void {
    if (this.current !== null) {
      if (this.undoStack.length > 15) {
        this.undoStack.shift();
      }
      this.undoStack.push(this.current);
    }
    this.redoStack = [];
    this.current = img;
    this.emit();
  }

  undo(): void {
    const last = this.undoStack.pop();
    if (!last) {
      return;
    }
    if (this.current !== null) {
      this.redoStack.push(this.current);
    }
    this.current = last;
    this.emit();
  }

  redo(): void {
    const last = this.redoStack.pop();
    if (!last) {
      return;
    }
    if (this.current !== null) {
      this.undoStack.push(this.current);
    }
    this.current = last;
    this.emit();
  }

  restore(): void {
    if (this.current !== null && this.initial !== null && this.current !== this.initial) {
      this.changeMainImage(this.initial);
    }
  }

  setStatus(status: string): void {
    this.status = status;
    this.emit();
  }
}
