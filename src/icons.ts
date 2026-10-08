// Minimal inline SVG icons for the tool strip (24x24, currentColor stroke).

import { ToolId } from './tools';

const WRAP = (inner: string): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const ICONS: Record<ToolId, string> = {
  move: WRAP(
    '<path d="M12 3v18M3 12h18M12 3l-2.5 2.5M12 3l2.5 2.5M12 21l-2.5-2.5M12 21l2.5-2.5M3 12l2.5-2.5M3 12l2.5 2.5M21 12l-2.5-2.5M21 12l-2.5 2.5"/>',
  ),
  hand: WRAP(
    '<path d="M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0 0V4.5a1.5 1.5 0 0 1 3 0V11m0 0V5.5a1.5 1.5 0 0 1 3 0V13m0-1.5a1.5 1.5 0 0 1 3 0V15a5 5 0 0 1-5 5h-2a5 5 0 0 1-5-5v-2"/>',
  ),
  zoom: WRAP('<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5 21 21M8 11h6M11 8v6"/>'),
  brush: WRAP('<path d="M14.5 4.5 19.5 9.5 9 20H4v-5z"/><path d="M13 6 18 11"/>'),
  eraser: WRAP('<path d="M4 16 12 8l5 5-8 8H7z"/><path d="M12 8l3.5-3.5a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L17 13z"/>'),
  bucket: WRAP(
    '<path d="M6 11 12 5l7 7-6 6a2 2 0 0 1-3 0l-4-4a2 2 0 0 1 0-3z"/><path d="M9 8 7.5 6.5a2 2 0 0 1 0-3"/><path d="M19 14c1.5 2 2 3.2 2 4a2 2 0 1 1-4 0c0-.8.5-2 2-4z"/>',
  ),
  lasso: WRAP(
    '<path d="M12 5c4.4 0 8 2.2 8 5s-3.6 5-8 5c-1.2 0-2.4-.2-3.4-.5"/><path d="M8.6 14.5C6 13.6 4 11.9 4 10c0-1.5 1-2.8 2.7-3.8"/><path d="M8 15.5c-1.2 1-1 4.4.2 4.4 1 0 1.4-2 .3-4.3"/>',
  ),
  wand: WRAP('<path d="M4 20 15 9"/><path d="M14 8l3-3"/><path d="M17 3v4M15 5h4M19 10v3M17.5 11.5h3M6 4v3M4.5 5.5h3"/>'),
  marquee: WRAP('<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 3"/>'),
  eyedropper: WRAP('<path d="M18.5 3.5a2.1 2.1 0 0 1 3 3l-2.2 2.2 1 1-2 2-1-1L8 20l-4 1 1-4 9.3-9.3-1-1 2-2 1 1z"/>'),
  text: WRAP('<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>'),
  resize: WRAP('<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>'),
};

export function toolIcon(id: ToolId): string {
  return ICONS[id];
}
