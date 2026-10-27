// Minimal inline SVG icons for the tool strip (24x24, currentColor stroke).

import { ToolId } from '../core/tools';

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
    brush: WRAP(
        '<path d="M9.6 12.2 17.9 3.9a1.75 1.75 0 0 1 2.5 2.5l-8.3 8.3"/>' +
            '<path d="M7.1 14.9c-1.7 0-3 1.4-3 3 0 1.3-2.5 1.5-2 2 1.1 1.1 2.5 2 4 2 2.2 0 4-1.8 4-4 0-1.7-1.3-3-3-3z"/>',
    ),
    eraser: WRAP('<path d="M4 16 12 8l5 5-8 8H7z"/><path d="M12 8l3.5-3.5a2 2 0 0 1 3 0l2 2a2 2 0 0 1 0 3L17 13z"/>'),
    clone: WRAP(
        '<rect x="9" y="2.5" width="6" height="2.6" rx="1.3"/>' +
            '<path d="M12 5.1v1.4"/>' +
            '<path d="M8.5 6.5h7l-1.2 5H9.7z"/>' +
            '<rect x="6.5" y="11.5" width="11" height="2.8" rx="0.8"/>' +
            '<path d="M4.5 17.5h15"/>',
    ),
    heal: WRAP(
        '<g transform="rotate(-45 12 12)"><rect x="4" y="9" width="16" height="6" rx="3"/><circle cx="10.5" cy="12" r="0.7"/><circle cx="13.5" cy="12" r="0.7"/></g>' +
            '<path d="M5 3v4M3 5h4"/>' +
            '<path d="M19 17v4M17 19h4"/>',
    ),
    knife: WRAP(
        '<g transform="rotate(-30 12 12)">' +
            '<rect x="2" y="9" width="6" height="4" rx="1.2"/>' +
            '<path d="M8 8.5H21C18.5 12 14 14 8 14.5z"/>' +
            '</g>',
    ),
    bucket: WRAP(
        '<path d="M6 11 12 5l7 7-6 6a2 2 0 0 1-3 0l-4-4a2 2 0 0 1 0-3z"/><path d="M9 8 7.5 6.5a2 2 0 0 1 0-3"/>' +
            '<path d="M16.5 9.5C17.5 7.5 19.5 6.5 20.8 8C22 9.5 22 11.8 21.4 14C20.8 16.5 19.5 18.5 18 18.5C17 18.5 16.5 17.5 16.8 16C17.5 14 18.5 13 19 12Z" fill="currentColor" stroke="none"/>',
    ),
    lasso: WRAP(
        '<path d="M12 5c4.4 0 8 2.2 8 5s-3.6 5-8 5c-1.2 0-2.4-.2-3.4-.5"/><path d="M8.6 14.5C6 13.6 4 11.9 4 10c0-1.5 1-2.8 2.7-3.8"/><path d="M8 15.5c-1.2 1-1 4.4.2 4.4 1 0 1.4-2 .3-4.3"/>',
    ),
    wand: WRAP(
        '<path d="M3.5 20.5 13.8 11.5"/>' +
            '<path d="M17 1.5 18.4 5.1 22.2 5.3 19.2 7.7 20.2 11.5 17 9.3 13.8 11.5 14.8 7.7 11.8 5.3 15.6 5.1z" fill="currentColor"/>' +
            '<path d="M6.5 3v3M5 4.5h3"/>' +
            '<path d="M20 15v2.5M18.75 16.25h2.5"/>',
    ),
    marquee: WRAP('<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 3"/>'),
    eyedropper: WRAP(
        '<path d="M18.5 3.5a2.1 2.1 0 0 1 3 3l-2.2 2.2 1 1-2 2-1-1L8 20l-4 1 1-4 9.3-9.3-1-1 2-2 1 1z"/>' +
            '<path d="M16.3 5.7 19.3 8.7"/>',
    ),
    text: WRAP('<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>'),
    measure: WRAP(
        '<rect x="2.5" y="8" width="19" height="8" rx="1"/><path d="M6 16v-3.5M9.5 16v-5M13 16v-3.5M16.5 16v-5"/>',
    ),
    resize: WRAP('<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>'),
};

// Each icon is drawn around its own natural bounds, so the raw paths had
// different visual sizes and centers. These fits scale every icon to the same
// visual size (20 units including the 1.8 stroke) and center it in the 24x24
// box. The root stroke width is divided by the scale so the stroke stays 1.8.
const FITS: Record<ToolId, { dx: number; dy: number; s: number }> = {
    move: { dx: -0.13, dy: -0.13, s: 1.011 },
    hand: { dx: -2.99, dy: -0.31, s: 1.071 },
    zoom: { dx: -1.38, dy: -1.38, s: 1.071 },
    brush: { dx: 0.94, dy: -0.18, s: 0.964 },
    eraser: { dx: -1.34, dy: -1.15, s: 1.059 },
    clone: { dx: -2.56, dy: -0.13, s: 1.213 },
    heal: { dx: -0.13, dy: -0.13, s: 1.011 },
    knife: { dx: 1.41, dy: 0.94, s: 0.936 },
    bucket: { dx: -2.98, dy: -0.25, s: 1.105 },
    lasso: { dx: -1.65, dy: -2.16, s: 1.137 },
    wand: { dx: -0.31, dy: 1.46, s: 0.958 },
    marquee: { dx: -1.65, dy: -1.65, s: 1.137 },
    eyedropper: { dx: -1.12, dy: 0.01, s: 1.004 },
    text: { dx: -1.65, dy: -1.65, s: 1.137 },
    measure: { dx: 0.51, dy: 0.51, s: 0.958 },
    resize: { dx: -0.13, dy: -0.13, s: 1.011 },
};

export function toolIcon(id: ToolId): string {
    const svg = ICONS[id];
    const fit = FITS[id];
    const inner = svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>'));
    return (
        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" ` +
        `stroke-width="${(1.8 / fit.s).toFixed(3)}" stroke-linecap="round" stroke-linejoin="round">` +
        `<g transform="translate(${fit.dx} ${fit.dy}) scale(${fit.s})">${inner}</g>` +
        `</svg>`
    );
}

// Layer visibility toggles (shared by the full Layers panel and the mini list).
export const EYE_ICON = WRAP('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>');
export const EYE_OFF_ICON = WRAP(
    '<path d="M3 3l18 18"/><path d="M10.6 10.6a3 3 0 0 0 4.2 4.2"/><path d="M9.9 5.2A11 11 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 3.9"/><path d="M6.1 6.1A17.7 17.7 0 0 0 2 12s3.5 7 10 7a10.8 10.8 0 0 0 4.1-.8"/>',
);
