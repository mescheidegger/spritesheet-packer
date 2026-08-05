/**
 * A sprite frame moving through the processing pipeline.
 *
 * @typedef {object} Frame
 * @property {string} name
 * @property {number} sourceIndex
 * @property {number} width
 * @property {number} height
 * @property {CanvasImageSource} [source]
 */

/**
 * A rectangular pixel region.
 *
 * @typedef {object} Bounds
 * @property {number} x
 * @property {number} y
 * @property {number} width
 * @property {number} height
 */

/**
 * @typedef {'row' | 'grid'} Layout
 */

/**
 * @typedef {'none' | 'shared' | 'per-frame'} TrimStrategy
 */

/**
 * Calculated sprite-sheet geometry.
 *
 * @typedef {object} SheetGeometry
 * @property {number} columns
 * @property {number} rows
 * @property {number} cellW
 * @property {number} cellH
 * @property {number} fullCellW
 * @property {number} fullCellH
 * @property {number} sheetW
 * @property {number} sheetH
 */

const MINIMUM_FRAME_NAME_DIGITS = 3;
const RGBA_CHANNEL_COUNT = 4;
const ALPHA_CHANNEL_OFFSET = 3;

/**
 * Throw when a value is not an integer meeting the specified minimum.
 *
 * @param {string} label
 * @param {number} value
 * @param {number} minimum
 * @throws {RangeError}
 */
function assertMinimumInteger(label, value, minimum) {
  if (!Number.isInteger(value) || value < minimum) {
    throw new RangeError(
      `${label} must be an integer of at least ${minimum}.`,
    );
  }
}

/**
 * Generate a consistently padded filename for a sliced frame.
 *
 * The number of digits expands automatically when the frame count
 * exceeds the default three-digit range.
 *
 * @param {number} index - Zero-based frame index.
 * @param {number} [count=1] - Total number of frames.
 * @returns {string}
 */
export function frameName(index, count = 1) {
  const finalIndex = Math.max(0, count - 1);

  const digitCount = Math.max(
    MINIMUM_FRAME_NAME_DIGITS,
    String(finalIndex).length,
  );

  const paddedIndex = String(index).padStart(digitCount, '0');

  return `frame_${paddedIndex}.png`;
}

/**
 * Calculate the row and column count for a packing layout.
 *
 * Grid layouts use the requested column count when supplied. Otherwise,
 * a roughly square grid is selected automatically.
 *
 * @param {number} frameCount
 * @param {Layout} layout
 * @param {number} [requestedColumns]
 * @returns {{columns: number, rows: number}}
 * @throws {RangeError}
 */
export function calculateLayout(
  frameCount,
  layout,
  requestedColumns,
) {
  if (!Number.isInteger(frameCount) || frameCount <= 0) {
    throw new RangeError(
      'Frame count must be a positive integer.',
    );
  }

  let columns;

  if (layout === 'row') {
    columns = frameCount;
  } else if (layout === 'grid') {
    const automaticColumns = Math.ceil(Math.sqrt(frameCount));
    const preferredColumns = requestedColumns || automaticColumns;

    columns = Math.min(preferredColumns, frameCount);
  } else {
    throw new RangeError(
      "Layout must be 'row' or 'grid'.",
    );
  }

  if (!Number.isInteger(columns) || columns <= 0) {
    throw new RangeError(
      'Columns must be a positive integer.',
    );
  }

  return {
    columns,
    rows: Math.ceil(frameCount / columns),
  };
}

/**
 * Calculate cell and output-sheet dimensions.
 *
 * Padding is applied independently to every side of each content cell.
 *
 * @param {number} frameCount
 * @param {number} cellWidth
 * @param {number} cellHeight
 * @param {number} padding
 * @param {Layout} layout
 * @param {number} [requestedColumns]
 * @returns {SheetGeometry}
 */
export function calculateGeometry(
  frameCount,
  cellWidth,
  cellHeight,
  padding,
  layout,
  requestedColumns,
) {
  assertMinimumInteger('cell width', cellWidth, 1);
  assertMinimumInteger('cell height', cellHeight, 1);
  assertMinimumInteger('padding', padding, 0);

  const { columns, rows } = calculateLayout(
    frameCount,
    layout,
    requestedColumns,
  );

  const fullCellWidth = cellWidth + padding * 2;
  const fullCellHeight = cellHeight + padding * 2;

  return {
    columns,
    rows,
    cellW: cellWidth,
    cellH: cellHeight,
    fullCellW: fullCellWidth,
    fullCellH: fullCellHeight,
    sheetW: columns * fullCellWidth,
    sheetH: rows * fullCellHeight,
  };
}

/**
 * Calculate a frame's centered position within the packed sheet.
 *
 * @param {number} index
 * @param {number} imageWidth
 * @param {number} imageHeight
 * @param {SheetGeometry} geometry
 * @param {number} padding
 * @returns {{row: number, col: number, x: number, y: number}}
 */
export function centeredPosition(
  index,
  imageWidth,
  imageHeight,
  geometry,
  padding,
) {
  const row = Math.floor(index / geometry.columns);
  const column = index % geometry.columns;

  const cellX = column * geometry.fullCellW;
  const cellY = row * geometry.fullCellH;

  const horizontalOffset = Math.floor(
    (geometry.cellW - imageWidth) / 2,
  );

  const verticalOffset = Math.floor(
    (geometry.cellH - imageHeight) / 2,
  );

  return {
    row,
    col: column,
    x: cellX + padding + horizontalOffset,
    y: cellY + padding + verticalOffset,
  };
}

/**
 * Find the smallest rectangle containing every nontransparent pixel.
 *
 * @param {ArrayLike<number>} rgba - Flat RGBA pixel data.
 * @param {number} width
 * @param {number} height
 * @returns {Bounds | null}
 * The visible bounds, or `null` when the image is fully transparent.
 */
export function findAlphaBounds(rgba, width, height) {
  const expectedLength = width * height * RGBA_CHANNEL_COUNT;

  if (rgba.length !== expectedLength) {
    throw new RangeError(
      'RGBA data length does not match its dimensions.',
    );
  }

  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelOffset =
        (y * width + x) * RGBA_CHANNEL_COUNT;

      const alpha = rgba[
        pixelOffset + ALPHA_CHANNEL_OFFSET
      ];

      if (alpha === 0) {
        continue;
      }

      left = Math.min(left, x);
      top = Math.min(top, y);
      right = Math.max(right, x);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < 0) {
    return null;
  }

  return {
    x: left,
    y: top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

/**
 * Calculate one rectangle containing the visible bounds of every frame.
 *
 * Null entries represent fully transparent frames and do not expand
 * the union.
 *
 * @param {Array<Bounds | null>} boundsList
 * @returns {Bounds | null}
 */
export function calculateUnionBounds(boundsList) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const bounds of boundsList) {
    if (!bounds) {
      continue;
    }

    left = Math.min(left, bounds.x);
    top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.width);
    bottom = Math.max(bottom, bounds.y + bounds.height);
  }

  if (!Number.isFinite(left)) {
    return null;
  }

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
}

/**
 * Determine whether every frame shares the same source dimensions.
 *
 * @param {Frame[]} frames
 * @returns {boolean}
 */
export function framesHaveMatchingDimensions(frames) {
  if (frames.length === 0) {
    return false;
  }

  const [firstFrame] = frames;

  return frames.every(
    (frame) =>
      frame.width === firstFrame.width &&
      frame.height === firstFrame.height,
  );
}

/**
 * Select the appropriate trimming strategy for a frame batch.
 *
 * Matching frame dimensions allow one shared crop rectangle, preserving
 * animation alignment. Mismatched frames must be trimmed independently.
 *
 * @param {Frame[]} frames
 * @param {boolean} trim
 * @returns {TrimStrategy}
 */
export function trimStrategy(frames, trim) {
  if (!trim) {
    return 'none';
  }

  return framesHaveMatchingDimensions(frames)
    ? 'shared'
    : 'per-frame';
}

/**
 * Calculate dimensions that fit proportionally within a square target.
 *
 * This operation allows both upscaling and downscaling.
 *
 * @param {number} width
 * @param {number} height
 * @param {number} targetSize
 * @returns {{width: number, height: number}}
 */
export function scaledDimensions(
  width,
  height,
  targetSize,
) {
  if (!Number.isInteger(targetSize) || targetSize <= 0) {
    throw new RangeError(
      'Target size must be a positive integer.',
    );
  }

  const scale = Math.min(
    targetSize / width,
    targetSize / height,
  );

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Create a canvas configured for pixel-art rendering.
 *
 * @param {number} width
 * @param {number} height
 * @param {boolean} [willReadFrequently=false]
 * @returns {{
 *   element: HTMLCanvasElement,
 *   context: CanvasRenderingContext2D
 * }}
 */
function createCanvas(
  width,
  height,
  willReadFrequently = false,
) {
  const element = document.createElement('canvas');

  element.width = width;
  element.height = height;

  const contextOptions = willReadFrequently
    ? { willReadFrequently: true }
    : undefined;

  const context = element.getContext('2d', contextOptions);

  if (!context) {
    throw new Error(
      'This browser could not create a 2D canvas context.',
    );
  }

  context.imageSmoothingEnabled = false;

  return {
    element,
    context,
  };
}

/**
 * Read a frame's visible alpha bounds.
 *
 * @param {Frame} frame
 * @returns {Bounds | null}
 */
function alphaBoundsForFrame(frame) {
  const surface = createCanvas(
    frame.width,
    frame.height,
    true,
  );

  surface.context.drawImage(frame.source, 0, 0);

  const imageData = surface.context.getImageData(
    0,
    0,
    frame.width,
    frame.height,
  );

  return findAlphaBounds(
    imageData.data,
    frame.width,
    frame.height,
  );
}

/**
 * Crop a frame to a specified rectangle.
 *
 * @param {Frame} frame
 * @param {Bounds} bounds
 * @returns {Frame}
 */
function cropFrame(frame, bounds) {
  const surface = createCanvas(
    bounds.width,
    bounds.height,
  );

  surface.context.drawImage(
    frame.source,
    bounds.x,
    bounds.y,
    bounds.width,
    bounds.height,
    0,
    0,
    bounds.width,
    bounds.height,
  );

  return {
    ...frame,
    source: surface.element,
    width: bounds.width,
    height: bounds.height,
  };
}

/**
 * Resize a frame proportionally to fit within a square target.
 *
 * @param {Frame} frame
 * @param {number} targetSize
 * @returns {Frame}
 */
function resizeFrame(frame, targetSize) {
  const dimensions = scaledDimensions(
    frame.width,
    frame.height,
    targetSize,
  );

  const surface = createCanvas(
    dimensions.width,
    dimensions.height,
  );

  surface.context.drawImage(
    frame.source,
    0,
    0,
    frame.width,
    frame.height,
    0,
    0,
    dimensions.width,
    dimensions.height,
  );

  return {
    ...frame,
    source: surface.element,
    width: dimensions.width,
    height: dimensions.height,
  };
}

/**
 * Process one frame with optional independent trimming and scaling.
 *
 * Independent trimming is intended for loose sprites. Animation batches
 * should normally be processed through `processFrames()` so they can use
 * shared trimming and preserve alignment.
 *
 * @param {Frame} frame
 * @param {boolean} trim
 * @param {number | null | undefined} targetSize
 * @returns {Frame}
 */
export function processFrame(
  frame,
  trim,
  targetSize,
) {
  let processedFrame = { ...frame };

  if (trim) {
    const bounds = alphaBoundsForFrame(processedFrame);

    if (bounds) {
      processedFrame = cropFrame(processedFrame, bounds);
    }
  }

  if (targetSize !== null && targetSize !== undefined) {
    processedFrame = resizeFrame(
      processedFrame,
      targetSize,
    );
  }

  return processedFrame;
}

/**
 * Process a complete frame batch.
 *
 * Matching animation frames use one shared trim rectangle to preserve
 * their common coordinate system. Frames with mismatched dimensions fall
 * back to independent trimming.
 *
 * @param {Frame[]} frames
 * @param {boolean} trim
 * @param {number | null | undefined} targetSize
 * @returns {Frame[]}
 */
export function processFrames(
  frames,
  trim,
  targetSize,
) {
  const strategy = trimStrategy(frames, trim);

  if (strategy === 'none') {
    return frames.map((frame) =>
      processFrame(frame, false, targetSize),
    );
  }

  if (strategy === 'per-frame') {
    return frames.map((frame) =>
      processFrame(frame, true, targetSize),
    );
  }

  const frameBounds = frames.map(alphaBoundsForFrame);
  const sharedBounds = calculateUnionBounds(frameBounds);

  // An entirely transparent batch retains its original coordinate system.
  const alignedFrames = sharedBounds
    ? frames.map((frame) => cropFrame(frame, sharedBounds))
    : frames;

  return alignedFrames.map((frame) =>
    processFrame(frame, false, targetSize),
  );
}

/**
 * Create the JSON-compatible sprite-sheet manifest.
 *
 * @param {string} output
 * @param {{
 *   layout: Layout,
 *   columns?: number,
 *   padding: number,
 *   trim: boolean,
 *   targetSize?: number | null
 * }} options
 * @param {SheetGeometry} geometry
 * @param {Frame[]} frames
 * @param {object | null | undefined} input
 * @returns {object}
 */
export function createManifest(
  output,
  options,
  geometry,
  frames,
  input,
) {
  const manifestFrames = frames.map((frame, index) => {
    const position = centeredPosition(
      index,
      frame.width,
      frame.height,
      geometry,
      options.padding,
    );

    return {
      index: frame.sourceIndex,
      name: frame.name,
      ...position,
      w: frame.width,
      h: frame.height,
      cell_w: geometry.cellW,
      cell_h: geometry.cellH,
      padding: options.padding,
    };
  });

  return {
    output: `${output}.png`,
    layout: options.layout,
    columns:
      options.layout === 'row'
        ? null
        : options.columns || 'auto',
    cell_w: geometry.cellW,
    cell_h: geometry.cellH,
    padding: options.padding,
    trim: options.trim,
    target_size: options.targetSize,
    ...(input ? { input } : {}),
    frames: manifestFrames,
  };
}

/**
 * Pack processed frames into a transparent sprite sheet.
 *
 * @param {Frame[]} frames
 * @param {{
 *   targetSize?: number | null,
 *   padding: number,
 *   layout: Layout,
 *   columns?: number
 * }} options
 * @returns {{
 *   canvas: HTMLCanvasElement,
 *   geometry: SheetGeometry
 * }}
 */
export function packFrames(frames, options) {
  if (frames.length === 0) {
    throw new RangeError(
      'At least one frame is required for packing.',
    );
  }

  const cellWidth =
    options.targetSize ??
    Math.max(...frames.map((frame) => frame.width));

  const cellHeight =
    options.targetSize ??
    Math.max(...frames.map((frame) => frame.height));

  const geometry = calculateGeometry(
    frames.length,
    cellWidth,
    cellHeight,
    options.padding,
    options.layout,
    options.columns,
  );

  const output = createCanvas(
    geometry.sheetW,
    geometry.sheetH,
  );

  if (
    output.element.width !== geometry.sheetW ||
    output.element.height !== geometry.sheetH
  ) {
    throw new Error(
      'The requested output exceeds this browser’s canvas limits.',
    );
  }

  frames.forEach((frame, index) => {
    const position = centeredPosition(
      index,
      frame.width,
      frame.height,
      geometry,
      options.padding,
    );

    output.context.drawImage(
      frame.source,
      position.x,
      position.y,
    );
  });

  return {
    canvas: output.element,
    geometry,
  };
}