import { AppContext } from '../context';
import { button, createDockPanel, createTabs, DockPanel, h, num, numeric } from '../dom';
import { closestColor, floydSteinbergDither, minAvgErrDither, orderedDither, randomDither } from '../dither';

interface MatrixCell {
  row: number;
  col: number;
  node: HTMLElement;
}

function matrixGrid(columns: number, cells: MatrixCell[]): HTMLElement {
  const grid = h('div', { class: 'matrix-grid' });
  grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
  for (const cell of cells) {
    cell.node.style.gridRow = String(cell.row + 1);
    cell.node.style.gridColumn = String(cell.col + 1);
    grid.append(cell.node);
  }
  return grid;
}

function star(): HTMLElement {
  return h('span', { class: 'matrix-star', text: '*' });
}

export function openDitherPanel(ctx: AppContext, onClose?: () => void): DockPanel {
  const panel = createDockPanel(ctx.dock, 'Dither', onClose);
  const { store } = ctx;

  const apply = async (status: string, task: () => ImageData): Promise<void> => {
    if (!store.activeImage || store.palette.length === 0) {
      return;
    }
    const result = await ctx.runTask(status, task);
    ctx.applyImage(result);
  };

  // --- Threshold ---
  const thresholdTab = h('div', { class: 'tab-content' }, [
    h('div', { class: 'button-row' }, [
      button('Threshold', () =>
        apply('Thresholding image', () => closestColor(store.activeImage!, store.palette.slice())),
      ),
    ]),
  ]);

  // --- Random ---
  const randomBias = numeric(10, { max: 13, width: 100 });
  const randomTab = h('div', { class: 'tab-content' }, [
    h('div', { class: 'row' }, [
      h('span', { class: 'row-label', text: 'Random bias:' }),
      h('div', { class: 'row-controls' }, [randomBias]),
    ]),
    h('div', { class: 'button-row' }, [
      button('Dither', () =>
        apply('Dithering image', () => randomDither(store.activeImage!, store.palette.slice(), num(randomBias))),
      ),
    ]),
  ]);

  // --- Ordered ---
  const orderedDefaults = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ];
  const orderedInputs: HTMLInputElement[][] = [];
  const orderedCells: MatrixCell[] = [];
  for (let r = 0; r < 4; r++) {
    orderedInputs.push([]);
    for (let c = 0; c < 4; c++) {
      const input = numeric(orderedDefaults[r][c]);
      orderedInputs[r].push(input);
      orderedCells.push({ row: r, col: c, node: input });
    }
  }
  const orderedTab = h('div', { class: 'tab-content' }, [
    h('div', { class: 'row' }, [
      h('span', { class: 'row-label', text: 'Dither matrix:' }),
      h('div', { class: 'row-controls' }, [matrixGrid(4, orderedCells)]),
    ]),
    h('div', { class: 'button-row' }, [
      button('Dither', () =>
        apply('Dithering image', () => {
          const matrix = orderedInputs.map((rowInputs) =>
            rowInputs.map((input) => Math.trunc(num(input)) / 16),
          );
          return orderedDither(store.activeImage!, store.palette.slice(), matrix);
        }),
      ),
    ]),
  ]);

  // --- 2 Row (Floyd-Steinberg) ---
  const fsRight = numeric(7);
  const fsDownLeft = numeric(3);
  const fsDown = numeric(5);
  const fsDownRight = numeric(1);
  const fsMultiplier = numeric(16);
  const fsCells: MatrixCell[] = [
    { row: 0, col: 1, node: star() },
    { row: 0, col: 2, node: fsRight },
    { row: 1, col: 0, node: fsDownLeft },
    { row: 1, col: 1, node: fsDown },
    { row: 1, col: 2, node: fsDownRight },
    {
      row: 2,
      col: 1,
      node: h('div', { class: 'inline' }, [h('span', { text: '*1/' }), fsMultiplier]),
    },
  ];
  const floSteinTab = h('div', { class: 'tab-content' }, [
    h('div', { class: 'row' }, [
      h('span', { class: 'row-label', text: 'Error Diffusion Matrix:' }),
      h('div', { class: 'row-controls' }, [matrixGrid(3, fsCells)]),
    ]),
    h('div', { class: 'button-row' }, [
      button('Dither', () =>
        apply('Dithering image', () => {
          const divisor = num(fsMultiplier) || 1;
          const matrix = [fsRight, fsDownLeft, fsDown, fsDownRight].map((input) => num(input) / divisor);
          return floydSteinbergDither(store.activeImage!, store.palette.slice(), matrix);
        }),
      ),
    ]),
  ]);

  // --- 3 Row (Min Avg Err) ---
  const minAvg = [
    numeric(7),
    numeric(5),
    numeric(3),
    numeric(5),
    numeric(7),
    numeric(5),
    numeric(3),
    numeric(1),
    numeric(3),
    numeric(5),
    numeric(3),
    numeric(1),
  ];
  const minAvgMultiplier = numeric(48);
  const minAvgCells: MatrixCell[] = [
    { row: 0, col: 2, node: star() },
    { row: 0, col: 3, node: minAvg[0] },
    { row: 0, col: 4, node: minAvg[1] },
    { row: 1, col: 0, node: minAvg[2] },
    { row: 1, col: 1, node: minAvg[3] },
    { row: 1, col: 2, node: minAvg[4] },
    { row: 1, col: 3, node: minAvg[5] },
    { row: 1, col: 4, node: minAvg[6] },
    { row: 2, col: 0, node: minAvg[7] },
    { row: 2, col: 1, node: minAvg[8] },
    { row: 2, col: 2, node: minAvg[9] },
    { row: 2, col: 3, node: minAvg[10] },
    { row: 2, col: 4, node: minAvg[11] },
    {
      row: 3,
      col: 2,
      node: h('div', { class: 'inline' }, [h('span', { text: '*1/' }), minAvgMultiplier]),
    },
  ];
  const minAvgTab = h('div', { class: 'tab-content' }, [
    h('div', { class: 'row' }, [
      h('span', { class: 'row-label', text: 'Error Diffusion Matrix:' }),
      h('div', { class: 'row-controls' }, [matrixGrid(5, minAvgCells)]),
    ]),
    h('div', { class: 'button-row' }, [
      button('Dither', () =>
        apply('Dithering image', () => {
          const divisor = num(minAvgMultiplier) || 1;
          const matrix = minAvg.map((input) => num(input) / divisor);
          return minAvgErrDither(store.activeImage!, store.palette.slice(), matrix);
        }),
      ),
    ]),
  ]);

  panel.body.append(
    createTabs([
      { label: 'Threshold', content: thresholdTab },
      { label: 'Random', content: randomTab },
      { label: 'Ordered', content: orderedTab },
      { label: '2 Row', content: floSteinTab },
      { label: '3 Row', content: minAvgTab },
    ]),
  );

  return panel;
}
