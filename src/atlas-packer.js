/**
 * Validate and normalize the dimensions shared by every atlas layout.
 *
 * @param {Array<{width: number, height: number}>} items
 * @param {object} options
 * @returns {{gap: number, widest: number, tallest: number}}
 */
function validateInputs(items, options) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new RangeError('At least one sprite sheet is required.');
  }

  for (const item of items) {
    if (!Number.isInteger(item.width) || item.width <= 0 ||
        !Number.isInteger(item.height) || item.height <= 0) {
      throw new RangeError('Every sprite sheet must have positive integer dimensions.');
    }
  }

  const gap = options.gap ?? 0;

  if (!Number.isInteger(gap) || gap < 0) {
    throw new RangeError('Gap must be a nonnegative integer.');
  }

  return {
    gap,
    widest: Math.max(...items.map((item) => item.width)),
    tallest: Math.max(...items.map((item) => item.height)),
  };
}

/**
 * Calculate atlas placements without requiring browser canvas APIs.
 *
 * @param {Array<{name: string, width: number, height: number}>} items
 * @param {{layout: 'horizontal'|'vertical'|'grid'|'compact', gap?: number,
 *   columns?: number, maxWidth?: number|null}} options
 * @returns {object}
 */
export function calculateAtlasLayout(items, options = {}) {
  const { gap, widest, tallest } = validateInputs(items, options);
  const { layout } = options;
  let rows = null;
  let columns = null;
  let width;
  let height;
  let maxWidth = null;
  let placements = [];

  if (layout === 'horizontal') {
    rows = 1;
    columns = items.length;
    let x = 0;
    placements = items.map((item, index) => {
      const placement = { index, x, y: 0, w: item.width, h: item.height };
      x += item.width + gap;
      return placement;
    });
    width = x - gap;
    height = tallest;
  } else if (layout === 'vertical') {
    rows = items.length;
    columns = 1;
    let y = 0;
    placements = items.map((item, index) => {
      const placement = { index, x: 0, y, w: item.width, h: item.height };
      y += item.height + gap;
      return placement;
    });
    width = widest;
    height = y - gap;
  } else if (layout === 'grid') {
    const requested = options.columns;
    if (requested !== undefined && requested !== 0 &&
        (!Number.isInteger(requested) || requested <= 0)) {
      throw new RangeError('Columns must be a positive integer.');
    }
    columns = Math.min(requested || Math.ceil(Math.sqrt(items.length)), items.length);
    rows = Math.ceil(items.length / columns);
    width = columns * widest + (columns - 1) * gap;
    height = rows * tallest + (rows - 1) * gap;
    placements = items.map((item, index) => ({
      index,
      x: (index % columns) * (widest + gap) + Math.floor((widest - item.width) / 2),
      y: Math.floor(index / columns) * (tallest + gap) + Math.floor((tallest - item.height) / 2),
      w: item.width,
      h: item.height,
    }));
  } else if (layout === 'compact') {
    const derivedWidth = Math.max(widest, Math.ceil(Math.sqrt(
      items.reduce((sum, item) => sum + item.width * item.height, 0),
    )));
    maxWidth = options.maxWidth ?? derivedWidth;
    if (!Number.isInteger(maxWidth) || maxWidth <= 0) {
      throw new RangeError('Maximum atlas width must be a positive integer.');
    }
    if (maxWidth < widest) {
      throw new RangeError(`Maximum atlas width must be at least ${widest}.`);
    }

    const ordered = items.map((item, index) => ({ item, index })).sort(
      (a, b) => b.item.height - a.item.height ||
        b.item.width - a.item.width || a.index - b.index,
    );
    let x = 0;
    let y = 0;
    let shelfHeight = 0;
    let usedWidth = 0;
    const byIndex = [];
    for (const { item, index } of ordered) {
      if (x > 0 && x + item.width > maxWidth) {
        y += shelfHeight + gap;
        x = 0;
        shelfHeight = 0;
      }
      byIndex[index] = { index, x, y, w: item.width, h: item.height };
      usedWidth = Math.max(usedWidth, x + item.width);
      shelfHeight = Math.max(shelfHeight, item.height);
      x += item.width + gap;
    }
    placements = byIndex;
    width = usedWidth;
    height = y + shelfHeight;
  } else {
    throw new RangeError("Atlas layout must be 'horizontal', 'vertical', 'grid', or 'compact'.");
  }

  for (const placement of placements) {
    if (placement.x < 0 || placement.y < 0 ||
        placement.x + placement.w > width || placement.y + placement.h > height) {
      throw new Error('An atlas placement falls outside the output bounds.');
    }
  }

  return {
    layout,
    width,
    height,
    sheetW: width,
    sheetH: height,
    gap,
    rows,
    columns,
    maxWidth,
    placements,
    itemNames: items.map((item) => item.name),
  };
}

/** Render complete sheets at their calculated, unmodified dimensions. */
export function renderAtlas(items, layout) {
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  if (canvas.width !== layout.width || canvas.height !== layout.height) {
    throw new Error('The requested output exceeds this browser’s canvas limits.');
  }
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not create the atlas canvas.');
  context.imageSmoothingEnabled = false;
  layout.placements.forEach((placement) => {
    context.drawImage(items[placement.index].source, placement.x, placement.y);
  });
  return { canvas, geometry: layout };
}

/** Create a sheet-level atlas manifest in original natural filename order. */
export function createAtlasManifest(output, options, layout) {
  return {
    output: `${output}.png`, type: 'atlas', layout: layout.layout,
    sheet_w: layout.width, sheet_h: layout.height, gap: layout.gap,
    rows: layout.rows, columns: layout.columns, max_width: layout.maxWidth,
    sheets: layout.placements.map((placement) => ({
      index: placement.index,
      name: layout.itemNames[placement.index],
      x: placement.x, y: placement.y, w: placement.w, h: placement.h,
    })),
  };
}
