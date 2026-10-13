import { AppContext } from '../context';
import { DockPanel, h } from '../shared/dom';
import { openAdjustmentsPanel } from './adjustmentsPanel';
import { openDitherPanel } from './ditherPanel';
import { openEffectsPanel } from './effectsPanel';
import { openLayersPanel } from './layersPanel';
import { openModifiersPanel } from './modifiersPanel';
import { openPalettePanel } from './palettePanel';
import { openSettingsPanel } from './settingsPanel';

// Sidebar with the docked-panel toggles. A panel is closed and reopened with
// its own button; the mini layers list is appended by the app wiring.

export type PanelId = 'dither' | 'palette' | 'adjustments' | 'effects' | 'modifiers' | 'layers' | 'settings';

export interface Panels {
    sidebar: HTMLElement;
    isOpen(id: PanelId): boolean;
    toggle(id: PanelId): void;
    refreshButtons(): void;
    refreshDisabled(working: boolean): void;
}

export function createPanels(ctx: AppContext, onChanged: () => void): Panels {
    const open: Record<PanelId, DockPanel | null> = {
        palette: null,
        dither: null,
        adjustments: null,
        effects: null,
        modifiers: null,
        layers: null,
        settings: null,
    };

    const openers: Record<PanelId, (onClose: () => void) => DockPanel> = {
        palette: (onClose) => openPalettePanel(ctx, onClose),
        dither: (onClose) => openDitherPanel(ctx, onClose),
        adjustments: (onClose) => openAdjustmentsPanel(ctx, onClose),
        effects: (onClose) => openEffectsPanel(ctx, onClose),
        modifiers: (onClose) => openModifiersPanel(ctx, onClose),
        layers: (onClose) => openLayersPanel(ctx, onClose),
        settings: (onClose) => openSettingsPanel(ctx, onClose),
    };

    const buttons: Record<PanelId, HTMLButtonElement> = {
        dither: h('button', { class: 'btn sidebar-btn', text: 'Dither' }),
        palette: h('button', { class: 'btn sidebar-btn', text: 'Palette' }),
        adjustments: h('button', { class: 'btn sidebar-btn', text: 'Adjustments' }),
        effects: h('button', { class: 'btn sidebar-btn', text: 'Effects' }),
        modifiers: h('button', { class: 'btn sidebar-btn', text: 'Modifiers' }),
        layers: h('button', { class: 'btn sidebar-btn', text: 'Layers' }),
        settings: h('button', { class: 'btn sidebar-btn', text: 'Settings' }),
    };
    for (const id of Object.keys(buttons) as PanelId[]) {
        buttons[id].addEventListener('click', () => toggle(id));
    }

    function toggle(id: PanelId): void {
        const current = open[id];
        if (current) {
            current.close();
            return;
        }
        open[id] = openers[id](() => {
            open[id] = null;
            onChanged();
        });
        onChanged();
    }

    // Highlights a sidebar button while its panel is open (like the active tool).
    function refreshButtons(): void {
        for (const id of Object.keys(buttons) as PanelId[]) {
            buttons[id].classList.toggle('active', open[id] !== null);
        }
    }

    function refreshDisabled(working: boolean): void {
        for (const id of Object.keys(buttons) as PanelId[]) {
            buttons[id].disabled = working;
        }
    }

    const sidebar = h('div', { class: 'sidebar' }, [
        buttons.dither,
        buttons.palette,
        buttons.adjustments,
        buttons.effects,
        buttons.modifiers,
        buttons.layers,
        buttons.settings,
        h('div', { class: 'sidebar-spacer' }),
    ]);

    return {
        sidebar,
        isOpen: (id) => open[id] !== null,
        toggle,
        refreshButtons,
        refreshDisabled,
    };
}
