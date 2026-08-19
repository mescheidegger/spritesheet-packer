import { safeAdd, safeMultiply, validateCanvasAllocation } from './resource-limits.js';
import { calculateCompactRectangles } from './rectangle-packer.js';

/**
 * @typedef {'horizontal'|'vertical'|'grid'|'compact'} AtlasLayout
 */

/**
 * @typedef {Object} AtlasItem
 * @property {string} name
 * @property {number} width
 * @property {number} height
 * @property {CanvasImageSource} [source]
 */

/**
 * @typedef {Object} AtlasPlacement
 * @property {number} index
 * @property {number} x
 * @property {number} y
 * @property {number} w
 * @property {number} h
 */

/**
 * @typedef {Object} AtlasGeometry
 * @property {AtlasLayout} layout
 * @property {number} width
 * @property {number} height
 * @property {number} sheetW
 * @property {number} sheetH
 * @property {number} gap
 * @property {number|null} rows
 * @property {number|null} columns
 * @property {number|null} maxWidth
 * @property {AtlasPlacement[]} placements
 * @property {string[]} itemNames
 */

const VALID_LAYOUTS = new Set([
  'horizontal',
  'vertical',
  'grid',
  'compact',
]);

/**
 * Normalize compatible UI values to the names used by the atlas packer.
 *
 * Existing frame packing uses `row`, while atlas packing calls the same
 * arrangement `horizontal`. Accepting the alias here prevents the UI value
 * from causing a generic generation failure.
 *
 * @param {unknown} layout
 * @returns {AtlasLayout}
 */
function normalizeLayout(layout) {
  const normalized = layout === 'row' ? 'horizontal' : layout;

  if (typeof normalized !== 'string' || !VALID_LAYOUTS.has(normalized)) {
    throw new RangeError(
      "Atlas layout must be 'horizontal', 'vertical', 'grid', or 'compact'.",
    );
  }

  return /** @type {AtlasLayout} */ (normalized);
}

/**
 * Validate values shared by every atlas layout.
 *
 * @param {AtlasItem[]} items
 * @param {{gap?: number}} options
 * @returns {{
 *   gap: number,
 *   widest: number,
 *   tallest: number,
 * }}
 */
function validateInputs(items, options) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new RangeError('At least one sprite sheet is required.');
  }

  let widest = 0;
  let tallest = 0;

  for (const item of items) {
    if (
      !Number.isInteger(item?.width) ||
      item.width <= 0 ||
      !Number.isInteger(item?.height) ||
      item.height <= 0
    ) {
      throw new RangeError(
        'Every sprite sheet must have positive integer dimensions.',
      );
    }

    widest = Math.max(widest, item.width);
    tallest = Math.max(tallest, item.height);
  }

  const gap = options.gap ?? 0;

  if (!Number.isInteger(gap) || gap < 0) {
    throw new RangeError('Gap must be a nonnegative integer.');
  }

  return {
    gap,
    widest,
    tallest,
  };
}

/**
 * Resolve the number of columns used by a grid layout.
 *
 * @param {number} itemCount
 * @param {number|undefined} requestedColumns
 * @returns {number}
 */
function resolveGridColumns(itemCount, requestedColumns) {
  if (
    requestedColumns !== undefined &&
    requestedColumns !== 0 &&
    (!Number.isInteger(requestedColumns) || requestedColumns <= 0)
  ) {
    throw new RangeError('Columns must be a positive integer.');
  }

  const automaticColumns = Math.ceil(Math.sqrt(itemCount));

  return Math.min(
    requestedColumns || automaticColumns,
    itemCount,
  );
}

/**
 * Place sheets from left to right without changing their dimensions.
 *
 * @param {AtlasItem[]} items
 * @param {number} gap
 * @param {number} tallest
 * @returns {Pick<
 *   AtlasGeometry,
 *   'width'|'height'|'rows'|'columns'|'maxWidth'|'placements'
 * >}
 */
function calculateHorizontal(items, gap, tallest) {
  let x = 0;

  const placements = items.map((item, index) => {
    const placement = {
      index,
      x,
      y: 0,
      w: item.width,
      h: item.height,
    };

    x = safeAdd('Horizontal atlas width', x, item.width, gap);

    return placement;
  });

  return {
    width: x - gap,
    height: tallest,
    rows: 1,
    columns: items.length,
    maxWidth: null,
    placements,
  };
}

/**
 * Place sheets from top to bottom without changing their dimensions.
 *
 * @param {AtlasItem[]} items
 * @param {number} gap
 * @param {number} widest
 * @returns {Pick<
 *   AtlasGeometry,
 *   'width'|'height'|'rows'|'columns'|'maxWidth'|'placements'
 * >}
 */
function calculateVertical(items, gap, widest) {
  let y = 0;

  const placements = items.map((item, index) => {
    const placement = {
      index,
      x: 0,
      y,
      w: item.width,
      h: item.height,
    };

    y = safeAdd('Vertical atlas height', y, item.height, gap);

    return placement;
  });

  return {
    width: widest,
    height: y - gap,
    rows: items.length,
    columns: 1,
    maxWidth: null,
    placements,
  };
}

/**
 * Place sheets at the top-left of uniformly sized grid cells.
 *
 * @param {AtlasItem[]} items
 * @param {number} gap
 * @param {number} widest
 * @param {number} tallest
 * @param {number|undefined} requestedColumns
 * @returns {Pick<
 *   AtlasGeometry,
 *   'width'|'height'|'rows'|'columns'|'maxWidth'|'placements'
 * >}
 */
function calculateGrid(
  items,
  gap,
  widest,
  tallest,
  requestedColumns,
) {
  const columns = resolveGridColumns(
    items.length,
    requestedColumns,
  );

  const rows = Math.ceil(items.length / columns);

  const placements = items.map((item, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);

    return {
      index,
      x: safeMultiply('Grid atlas x', column, safeAdd('Grid atlas cell width', widest, gap)),
      y: safeMultiply('Grid atlas y', row, safeAdd('Grid atlas cell height', tallest, gap)),
      w: item.width,
      h: item.height,
    };
  });

  return {
    width: safeAdd('Grid atlas width', safeMultiply('Grid atlas width', columns, widest), safeMultiply('Grid atlas horizontal gaps', columns - 1, gap)),
    height: safeAdd('Grid atlas height', safeMultiply('Grid atlas height', rows, tallest), safeMultiply('Grid atlas vertical gaps', rows - 1, gap)),
    rows,
    columns,
    maxWidth: null,
    placements,
  };
}

/**
 * Pack variable-sized sheets into deterministic height-sorted shelves.
 *
 * Sheets may be reordered temporarily to improve packing, but placements are
 * returned in their original natural filename order.
 *
 * @param {AtlasItem[]} items
 * @param {number} gap
 * @param {number|null|undefined} requestedMaxWidth
 * @returns {Pick<
 *   AtlasGeometry,
 *   'width'|'height'|'rows'|'columns'|'maxWidth'|'placements'
 * >}
 */
function calculateCompact(
  items,
  gap,
  requestedMaxWidth,
) {
  const packed = calculateCompactRectangles(items, {
    gap,
    maxWidth: requestedMaxWidth,
    widthLabel: 'Maximum atlas width',
  });

  return {
    width: packed.width,
    height: packed.height,
    rows: null,
    columns: null,
    maxWidth: packed.maxWidth,
    placements: packed.placements,
  };
}

/**
 * Confirm that calculated placements are complete, in bounds, and distinct.
 *
 * @param {AtlasPlacement[]} placements
 * @param {number} itemCount
 * @param {number} width
 * @param {number} height
 */
function validatePlacements(
  placements,
  itemCount,
  width,
  height,
) {
  if (placements.length !== itemCount) {
    throw new Error(
      'Atlas layout did not place every sprite sheet.',
    );
  }

  for (const placement of placements) {
    if (
      !placement ||
      placement.x < 0 ||
      placement.y < 0 ||
      placement.x + placement.w > width ||
      placement.y + placement.h > height
    ) {
      throw new Error(
        'An atlas placement falls outside the output bounds.',
      );
    }
  }

  for (
    let first = 0;
    first < placements.length;
    first += 1
  ) {
    for (
      let second = first + 1;
      second < placements.length;
      second += 1
    ) {
      const a = placements[first];
      const b = placements[second];

      const overlaps =
        a.x < b.x + b.w &&
        a.x + a.w > b.x &&
        a.y < b.y + b.h &&
        a.y + a.h > b.y;

      if (overlaps) {
        throw new Error(
          'Atlas layout produced overlapping sprite sheets.',
        );
      }
    }
  }
}

/**
 * Calculate atlas placements without requiring browser canvas APIs.
 *
 * The legacy `row` layout value is accepted as an alias for `horizontal`.
 *
 * @param {AtlasItem[]} items
 * @param {{
 *   layout?: 'row'|AtlasLayout,
 *   gap?: number,
 *   columns?: number,
 *   maxWidth?: number|null
 * }} [options]
 * @returns {AtlasGeometry}
 */
export function calculateAtlasLayout(
  items,
  options = {},
) {
  const layout = normalizeLayout(options.layout);

  const {
    gap,
    widest,
    tallest,
  } = validateInputs(items, options);

  let geometry;

  if (layout === 'horizontal') {
    geometry = calculateHorizontal(
      items,
      gap,
      tallest,
    );
  } else if (layout === 'vertical') {
    geometry = calculateVertical(
      items,
      gap,
      widest,
    );
  } else if (layout === 'grid') {
    geometry = calculateGrid(
      items,
      gap,
      widest,
      tallest,
      options.columns,
    );
  } else {
    geometry = calculateCompact(
      items,
      gap,
      options.maxWidth,
    );
  }

  validateCanvasAllocation(
    geometry.width,
    geometry.height,
    'This atlas layout',
  );

  validatePlacements(
    geometry.placements,
    items.length,
    geometry.width,
    geometry.height,
  );

  return {
    layout,
    width: geometry.width,
    height: geometry.height,
    sheetW: geometry.width,
    sheetH: geometry.height,
    gap,
    rows: geometry.rows,
    columns: geometry.columns,
    maxWidth: geometry.maxWidth,
    placements: geometry.placements,
    itemNames: items.map((item) => item.name),
  };
}

/**
 * Render complete sheets at their calculated, unmodified dimensions.
 *
 * @param {AtlasItem[]} items
 * @param {AtlasGeometry} layout
 * @returns {{
 *   canvas: HTMLCanvasElement,
 *   geometry: AtlasGeometry
 * }}
 */
export function renderAtlas(items, layout) {
  validateCanvasAllocation(
    layout.width,
    layout.height,
    'This atlas layout',
  );

  const canvas = document.createElement('canvas');

  canvas.width = layout.width;
  canvas.height = layout.height;

  if (
    canvas.width !== layout.width ||
    canvas.height !== layout.height
  ) {
    throw new Error(
      'The requested output exceeds this browser’s canvas limits.',
    );
  }

  const context = canvas.getContext('2d');

  if (!context) {
    throw new Error(
      'This browser could not create the atlas canvas.',
    );
  }

  context.imageSmoothingEnabled = false;

  for (const placement of layout.placements) {
    const item = items[placement.index];

    if (!item?.source) {
      throw new TypeError(
        `Sprite sheet ${placement.index + 1} does not have a decoded image source.`,
      );
    }

    context.drawImage(
      item.source,
      placement.x,
      placement.y,
    );
  }

  return {
    canvas,
    geometry: layout,
  };
}

/**
 * Create a sheet-level manifest in original natural filename order.
 *
 * The second parameter remains part of the public signature for compatibility
 * with the existing manifest creation call.
 *
 * @param {string} output
 * @param {object} _options
 * @param {AtlasGeometry} layout
 * @returns {object}
 */
export function createAtlasManifest(
  output,
  _options,
  layout,
) {
  return {
    output: `${output}.png`,
    type: 'atlas',
    layout: layout.layout,
    sheet_w: layout.width,
    sheet_h: layout.height,
    gap: layout.gap,
    rows: layout.rows,
    columns: layout.columns,
    max_width: layout.maxWidth,
    sheets: [...layout.placements]
      .sort((a, b) => a.index - b.index)
      .map((placement) => ({
        index: placement.index,
        name: layout.itemNames[placement.index],
        x: placement.x,
        y: placement.y,
        w: placement.w,
        h: placement.h,
      })),
  };
}
