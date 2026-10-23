// Shared node-tree list used by the Layers panel and the sidebar mini list:
// renders groups (with their children indented, groups can nest), handles
// selection (click / Ctrl+click / Shift+click), per-node visibility, renaming
// and drag & drop.
//
// Drop rules:
//   - dropping on a group header puts the node at the top of that group;
//   - dropping in a gap inserts at the row-below's level (so gaps between a
//     group's children stay inside it, and the gap above a group header is
//     above the group);
//   - dropping at the very bottom inserts below the last row.

import { findParent, isGroup, isLayer, LayerGroup, LayerNode } from '../core/layers';
import { h } from '../shared/dom';
import type { Store } from '../core/store';
import { EYE_ICON, EYE_OFF_ICON } from './icons';
import { openLayerContextMenu } from './layerContextMenu';

export interface LayerListOptions {
    store: Store;
    listClass: string;
    rowClass: string;
    headerClass: string;
    nameClass: string;
    renameClass: string;
    rename: boolean;
    indentBase: number;
    indentStep: number;
}

export interface LayerList {
    root: HTMLElement;
    sync(): void;
    renameActive(): void;
}

interface RowBase {
    node: LayerNode;
    parent: LayerGroup | null;
    depth: number;
}

interface DisplayRow extends RowBase {
    element: HTMLElement;
}

export function createLayerList(options: LayerListOptions): LayerList {
    const { store } = options;
    const root = h('div', { class: options.listClass });
    let rows: DisplayRow[] = [];
    let lastSignature = '';
    let ignoreClick = false;

    let drag: {
        pointerId: number;
        // Element that received the pointerdown (gets pointer capture).
        row: HTMLElement;
        startY: number;
        moved: boolean;
        movingIds: number[];
        targetParentId: number | null;
        targetIndex: number;
        valid: boolean;
    } | null = null;

    // --- Structure signature (rebuild only when the tree itself changed) ---

    const signature = (): string => {
        const part = (nodes: LayerNode[]): string =>
            nodes
                .map((node) =>
                    isGroup(node)
                        ? `g${node.id}:${node.visible}:${node.name}[${part(node.children)}]`
                        : `l${node.id}:${node.visible}:${node.name}`,
                )
                .join(',');
        return part(store.nodes);
    };

    // --- Element building ---

    // The rename input currently open, so starting another rename can finish
    // it first (and so commits never leave a stray input behind).
    let openRename: { input: HTMLInputElement; commit: (save: boolean) => void } | null = null;

    const startRename = (node: LayerNode): void => {
        if (!options.rename) {
            return;
        }
        // Double-clicking another name finishes the one still being edited.
        openRename?.commit(true);
        const row = rows.find((entry) => entry.node.id === node.id);
        if (!row || row.element.querySelector('input')) {
            return;
        }
        const nameEl = row.element.querySelector(`.${options.nameClass}`);
        if (!nameEl) {
            return;
        }
        const input = document.createElement('input');
        input.type = 'text';
        input.className = options.renameClass;
        input.value = node.name;
        input.addEventListener('pointerdown', (event) => event.stopPropagation());
        let done = false;
        const commit = (save: boolean): void => {
            if (done) {
                return;
            }
            done = true;
            if (openRename?.input === input) {
                openRename = null;
            }
            if (save) {
                store.renameNode(node.id, input.value);
            }
            sync();
            // When the name did not change the list was not rebuilt, so put the
            // plain name element back ourselves.
            if (input.parentElement) {
                input.replaceWith(nameEl);
            }
        };
        input.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                commit(true);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                commit(false);
            }
        });
        input.addEventListener('blur', () => commit(true));
        openRename = { input, commit };
        nameEl.replaceWith(input);
        input.focus();
        input.select();
    };

    const createElement = (row: RowBase): HTMLElement => {
        const node = row.node;
        const eye = h('button', {
            class: `layer-eye${node.visible ? '' : ' off'}`,
            title: node.visible ? 'Hide' : 'Show',
        });
        eye.innerHTML = node.visible ? EYE_ICON : EYE_OFF_ICON;
        eye.addEventListener('pointerdown', (event) => event.stopPropagation());
        eye.addEventListener('click', (event) => {
            event.stopPropagation();
            store.setNodeVisible(node.id, !node.visible);
        });
        const name = h('span', { class: options.nameClass, text: node.name, title: node.name });
        if (options.rename) {
            name.addEventListener('dblclick', (event) => {
                event.stopPropagation();
                startRename(node);
            });
        }
        const element = h('div', { class: isGroup(node) ? options.headerClass : options.rowClass }, [eye, name]);
        element.style.paddingLeft = `${options.indentBase + row.depth * options.indentStep}px`;
        element.dataset.id = String(node.id);
        element.addEventListener('click', (event) => {
            if (ignoreClick) {
                ignoreClick = false;
                return;
            }
            store.setLayerFocus(true);
            const mode = event.shiftKey ? 'range' : event.ctrlKey || event.metaKey ? 'toggle' : 'replace';
            store.selectNode(node.id, mode);
        });
        element.addEventListener('pointerdown', (event) => onRowDown(event, row));
        element.addEventListener('pointermove', onRowMove);
        element.addEventListener('pointerup', onRowUp);
        element.addEventListener('pointercancel', onRowUp);
        element.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (!store.isNodeSelected(node.id)) {
                store.selectNode(node.id, 'replace');
            }
            store.setLayerFocus(true);
            openLayerContextMenu(
                node,
                {
                    rename: (id) => {
                        const target = rows.find((entry) => entry.node.id === id);
                        if (target) {
                            startRename(target.node);
                        }
                    },
                },
                event.clientX,
                event.clientY,
            );
        });
        return element;
    };

    const buildRows = (nodes: LayerNode[], parent: LayerGroup | null, depth: number, out: DisplayRow[]): void => {
        for (let i = nodes.length - 1; i >= 0; i--) {
            const node = nodes[i];
            const base: RowBase = { node, parent, depth };
            // The element is only built after the base data exists, so the row
            // never needs a placeholder for its element.
            const row: DisplayRow = { ...base, element: createElement(base) };
            out.push(row);
            if (isGroup(node)) {
                buildRows(node.children, node, depth + 1, out);
            }
        }
    };

    // --- Drag & drop ---

    const onRowDown = (event: PointerEvent, row: RowBase): void => {
        // The listener is attached to the row element itself.
        const rowElement = event.currentTarget;
        if (!(rowElement instanceof HTMLElement)) {
            return;
        }
        if ((event.target as HTMLElement).closest('input, button') || event.button !== 0) {
            return;
        }
        // A plain press on an unselected row selects it, so the drag moves what
        // the user sees selected.
        if (!store.isNodeSelected(row.node.id) && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
            store.selectNode(row.node.id, 'replace');
            store.setLayerFocus(true);
        }
        const selected = store.topLevelSelectedNodes();
        const movingIds = selected.some((node) => node.id === row.node.id)
            ? selected.map((node) => node.id)
            : [row.node.id];
        drag = {
            pointerId: event.pointerId,
            row: rowElement,
            startY: event.clientY,
            moved: false,
            movingIds,
            targetParentId: null,
            targetIndex: 0,
            valid: false,
        };
    };

    // Never drop a group into itself or one of its own descendants.
    const canDropInto = (parentId: number | null, movingIds: number[]): boolean => {
        if (parentId === null) {
            return true;
        }
        const moving = new Set(movingIds);
        if (moving.has(parentId)) {
            return false;
        }
        let ancestor = findParent(store.nodes, parentId);
        while (ancestor) {
            if (moving.has(ancestor.id)) {
                return false;
            }
            ancestor = findParent(store.nodes, ancestor.id);
        }
        return true;
    };

    const clearIndicators = (): void => {
        for (const row of rows) {
            row.element.classList.remove('drop-above', 'drop-below', 'drop-into');
        }
    };

    const onRowMove = (event: PointerEvent): void => {
        const state = drag;
        if (!state || event.pointerId !== state.pointerId) {
            return;
        }
        if (!state.moved && Math.abs(event.clientY - state.startY) < 4) {
            return;
        }
        if (!state.moved) {
            state.moved = true;
            // Capture the pointer so the drop still resolves when it is
            // released over a gap, the list background or another panel.
            state.row.setPointerCapture(event.pointerId);
            for (const row of rows) {
                if (state.movingIds.includes(row.node.id)) {
                    row.element.classList.add('dragging');
                }
            }
        }
        clearIndicators();

        // Dropping on the middle of a group header joins that group (top).
        for (const row of rows) {
            if (!isGroup(row.node)) {
                continue;
            }
            const rect = row.element.getBoundingClientRect();
            const band = Math.min(6, rect.height * 0.25);
            if (event.clientY >= rect.top + band && event.clientY <= rect.bottom - band) {
                state.targetParentId = row.node.id;
                state.targetIndex = row.node.children.length;
                state.valid = canDropInto(state.targetParentId, state.movingIds);
                if (state.valid) {
                    row.element.classList.add('drop-into');
                }
                return;
            }
        }

        // Otherwise resolve the gap between rows; the row below the gap decides
        // the level (its parent) and the position (just above it). The index is
        // counted over the nodes that stay, because the dragged ones are
        // removed before the insertion.
        let gap = rows.length;
        for (let i = 0; i < rows.length; i++) {
            const rect = rows[i].element.getBoundingClientRect();
            if (event.clientY < rect.top + rect.height / 2) {
                gap = i;
                break;
            }
        }
        const below = rows[gap];
        const last = rows[rows.length - 1] ?? null;
        const parent = below ? below.parent : (last ? last.parent : null);
        const list = parent ? parent.children : store.nodes;
        const anchor = below ? below.node : (last ? last.node : null);
        const moving = new Set(state.movingIds);
        let index = list.length;
        if (anchor) {
            const anchorIndex = list.indexOf(anchor);
            index = below
                ? // Above the row below the gap = after it in the bottom-to-top
                  // array.
                  list.slice(0, anchorIndex + 1).filter((node) => !moving.has(node.id)).length
                : // Bottom gap: directly below the last row = before it.
                  list.slice(0, anchorIndex).filter((node) => !moving.has(node.id)).length;
        }
        state.targetParentId = parent ? parent.id : null;
        state.targetIndex = Math.max(0, index);
        state.valid = canDropInto(state.targetParentId, state.movingIds);
        if (!state.valid) {
            return;
        }
        if (below) {
            below.element.classList.add('drop-above');
        } else if (last) {
            last.element.classList.add('drop-below');
        }
    };

    const onRowUp = (event: PointerEvent): void => {
        const state = drag;
        if (!state || event.pointerId !== state.pointerId) {
            return;
        }
        drag = null;
        if (state.row.hasPointerCapture(event.pointerId)) {
            state.row.releasePointerCapture(event.pointerId);
        }
        for (const row of rows) {
            row.element.classList.remove('dragging');
        }
        clearIndicators();
        if (!state.moved) {
            return;
        }
        // Swallow the click the browser fires after the drag, but let the flag
        // expire so later clicks are never eaten.
        ignoreClick = true;
        window.setTimeout(() => {
            ignoreClick = false;
        }, 0);
        if (!state.valid) {
            return;
        }
        store.moveNodes(state.movingIds, state.targetParentId, state.targetIndex);
    };

    // --- Sync ---

    const sync = (): void => {
        const sig = signature();
        if (sig !== lastSignature) {
            lastSignature = sig;
            rows = [];
            buildRows(store.nodes, null, 0, rows);
            root.replaceChildren(...rows.map((row) => row.element));
        }
        for (const row of rows) {
            row.element.classList.toggle('selected', store.isNodeSelected(row.node.id));
            row.element.classList.toggle('active', store.isNodeActive(row.node.id));
        }
    };

    const renameActive = (): void => {
        const row = rows.find((entry) => isLayer(entry.node) && entry.node.id === store.activeId);
        if (row) {
            startRename(row.node);
        }
    };

    return { root, sync, renameActive };
}
