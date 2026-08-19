import { safeAdd, safeMultiply } from './resource-limits.js';

/**
 * Deterministically pack rectangles into horizontal shelves without rotation.
 * Placements are returned in input order even though packing order is sorted.
 *
 * @param {Array<{width: number, height: number}>} items
 * @param {{gap?: number, maxWidth?: number|null, widthLabel?: string}} [options]
 * @returns {{width: number, height: number, maxWidth: number, placements: Array<{index: number, x: number, y: number, w: number, h: number}>}}
 */
export function calculateCompactRectangles(items, options = {}) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new RangeError('At least one rectangle is required.');
  }

  const gap = options.gap ?? 0;
  if (!Number.isInteger(gap) || gap < 0) {
    throw new RangeError('Gap must be a nonnegative integer.');
  }

  let widest = 0;
  let totalArea = 0;
  for (const item of items) {
    if (!Number.isInteger(item?.width) || item.width <= 0 ||
        !Number.isInteger(item?.height) || item.height <= 0) {
      throw new RangeError('Every rectangle must have positive integer dimensions.');
    }
    widest = Math.max(widest, item.width);
    totalArea = safeAdd('Total compact input area', totalArea,
      safeMultiply('Compact rectangle area', item.width, item.height));
  }

  const label = options.widthLabel ?? 'Maximum width';
  const maxWidth = options.maxWidth ?? Math.max(widest, Math.ceil(Math.sqrt(totalArea)));
  if (!Number.isInteger(maxWidth) || maxWidth <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
  if (maxWidth < widest) {
    throw new RangeError(`${label} must be at least ${widest}.`);
  }

  const ordered = items.map((item, index) => ({ item, index })).sort((a, b) =>
    b.item.height - a.item.height || b.item.width - a.item.width || a.index - b.index);
  const placements = new Array(items.length);
  let x = 0;
  let y = 0;
  let shelfHeight = 0;
  let usedWidth = 0;

  for (const { item, index } of ordered) {
    if (x > 0 && x + item.width > maxWidth) {
      y = safeAdd('Compact packing y', y, shelfHeight, gap);
      x = 0;
      shelfHeight = 0;
    }
    placements[index] = { index, x, y, w: item.width, h: item.height };
    usedWidth = Math.max(usedWidth, safeAdd('Compact packing used width', x, item.width));
    shelfHeight = Math.max(shelfHeight, item.height);
    x = safeAdd('Compact packing x', x, item.width, gap);
  }

  return {
    width: usedWidth,
    height: safeAdd('Compact packing height', y, shelfHeight),
    maxWidth,
    placements,
  };
}
