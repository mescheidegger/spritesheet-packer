/** @typedef {{name:string, sourceIndex:number, width:number, height:number, source?:CanvasImageSource}} Frame */

export function frameName(index, count = 1) {
  return `frame_${String(index).padStart(Math.max(3, String(Math.max(0, count - 1)).length), '0')}.png`;
}

export function calculateLayout(frameCount, layout, requestedColumns) {
  if (!Number.isInteger(frameCount) || frameCount <= 0) throw new RangeError('Frame count must be a positive integer.');
  let columns;
  if (layout === 'row') columns = frameCount;
  else if (layout === 'grid') columns = Math.min(requestedColumns || Math.ceil(Math.sqrt(frameCount)), frameCount);
  else throw new RangeError("Layout must be 'row' or 'grid'.");
  if (!Number.isInteger(columns) || columns <= 0) throw new RangeError('Columns must be a positive integer.');
  return { columns, rows: Math.ceil(frameCount / columns) };
}

export function calculateGeometry(frameCount, cellW, cellH, padding, layout, columns) {
  for (const [name, value, minimum] of [['cell width', cellW, 1], ['cell height', cellH, 1], ['padding', padding, 0]]) {
    if (!Number.isInteger(value) || value < minimum) throw new RangeError(`${name} must be an integer of at least ${minimum}.`);
  }
  const grid = calculateLayout(frameCount, layout, columns);
  const fullCellW = cellW + padding * 2;
  const fullCellH = cellH + padding * 2;
  return { ...grid, cellW, cellH, fullCellW, fullCellH, sheetW: grid.columns * fullCellW, sheetH: grid.rows * fullCellH };
}

export function centeredPosition(index, imageW, imageH, geometry, padding) {
  const row = Math.floor(index / geometry.columns);
  const col = index % geometry.columns;
  return {
    row, col,
    x: col * geometry.fullCellW + padding + Math.floor((geometry.cellW - imageW) / 2),
    y: row * geometry.fullCellH + padding + Math.floor((geometry.cellH - imageH) / 2),
  };
}

export function findAlphaBounds(rgba, width, height) {
  if (rgba.length !== width * height * 4) throw new RangeError('RGBA data length does not match its dimensions.');
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    if (rgba[(y * width + x) * 4 + 3] !== 0) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  return right < 0 ? null : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function calculateUnionBounds(bounds) {
  const visible = bounds.filter(Boolean);
  if (!visible.length) return null;
  const left = Math.min(...visible.map((bound) => bound.x));
  const top = Math.min(...visible.map((bound) => bound.y));
  const right = Math.max(...visible.map((bound) => bound.x + bound.width));
  const bottom = Math.max(...visible.map((bound) => bound.y + bound.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function framesHaveMatchingDimensions(frames) {
  return frames.length > 0 && frames.every((frame) => frame.width === frames[0].width && frame.height === frames[0].height);
}

export function trimStrategy(frames, trim) {
  if (!trim) return 'none';
  return framesHaveMatchingDimensions(frames) ? 'shared' : 'per-frame';
}

export function scaledDimensions(width, height, targetSize) {
  if (!Number.isInteger(targetSize) || targetSize <= 0) throw new RangeError('Target size must be a positive integer.');
  const scale = Math.min(targetSize / width, targetSize / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export function createManifest(output, options, geometry, frames) {
  return {
    output: `${output}.png`, layout: options.layout,
    columns: options.layout === 'row' ? null : (options.columns || 'auto'),
    cell_w: geometry.cellW, cell_h: geometry.cellH, padding: options.padding,
    trim: options.trim, target_size: options.targetSize,
    frames: frames.map((frame, index) => {
      const place = centeredPosition(index, frame.width, frame.height, geometry, options.padding);
      return { index: frame.sourceIndex, name: frame.name, ...place, w: frame.width, h: frame.height, cell_w: geometry.cellW, cell_h: geometry.cellH, padding: options.padding };
    }),
  };
}

function canvas(width, height, frequent = false) {
  const element = document.createElement('canvas'); element.width = width; element.height = height;
  const context = element.getContext('2d', frequent ? { willReadFrequently: true } : undefined);
  if (!context) throw new Error('This browser could not create a 2D canvas context.');
  context.imageSmoothingEnabled = false;
  return { canvas: element, context };
}

export function processFrame(frame, trim, targetSize) {
  let source = frame.source; let width = frame.width; let height = frame.height;
  if (trim) {
    const scratch = canvas(width, height, true); scratch.context.drawImage(source, 0, 0);
    const bounds = findAlphaBounds(scratch.context.getImageData(0, 0, width, height).data, width, height);
    if (bounds) {
      const cropped = canvas(bounds.width, bounds.height); cropped.context.drawImage(source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
      source = cropped.canvas; width = bounds.width; height = bounds.height;
    }
  }
  if (targetSize) {
    const scaled = scaledDimensions(width, height, targetSize); const resized = canvas(scaled.width, scaled.height);
    resized.context.drawImage(source, 0, 0, width, height, 0, 0, scaled.width, scaled.height);
    source = resized.canvas; ({ width, height } = scaled);
  }
  return { ...frame, source, width, height };
}

function alphaBoundsForFrame(frame) {
  const scratch = canvas(frame.width, frame.height, true);
  scratch.context.drawImage(frame.source, 0, 0);
  return findAlphaBounds(scratch.context.getImageData(0, 0, frame.width, frame.height).data, frame.width, frame.height);
}

function cropFrame(frame, bounds) {
  const cropped = canvas(bounds.width, bounds.height);
  cropped.context.drawImage(frame.source, bounds.x, bounds.y, bounds.width, bounds.height, 0, 0, bounds.width, bounds.height);
  return { ...frame, source: cropped.canvas, width: bounds.width, height: bounds.height };
}

export function processFrames(frames, trim, targetSize) {
  const strategy = trimStrategy(frames, trim);
  if (strategy === 'per-frame') return frames.map((frame) => processFrame(frame, true, targetSize));
  if (strategy === 'none') return frames.map((frame) => processFrame(frame, false, targetSize));

  const union = calculateUnionBounds(frames.map(alphaBoundsForFrame));
  // An entirely transparent batch keeps its original shared coordinate system.
  const cropped = union ? frames.map((frame) => cropFrame(frame, union)) : frames;
  return cropped.map((frame) => processFrame(frame, false, targetSize));
}

export function packFrames(frames, options) {
  const cellW = options.targetSize || Math.max(...frames.map((frame) => frame.width));
  const cellH = options.targetSize || Math.max(...frames.map((frame) => frame.height));
  const geometry = calculateGeometry(frames.length, cellW, cellH, options.padding, options.layout, options.columns);
  const output = canvas(geometry.sheetW, geometry.sheetH);
  if (output.canvas.width !== geometry.sheetW || output.canvas.height !== geometry.sheetH) throw new Error('The requested output exceeds this browser’s canvas limits.');
  frames.forEach((frame, index) => { const place = centeredPosition(index, frame.width, frame.height, geometry, options.padding); output.context.drawImage(frame.source, place.x, place.y); });
  return { canvas: output.canvas, geometry };
}
