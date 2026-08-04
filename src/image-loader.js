import { frameName } from './sprite-processor.js';
import { calculateSheetGrid } from './validation.js';

const SUPPORTED = new Set(['image/png', 'image/gif', 'image/jpeg', 'image/webp']);
const filenameCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortFilesNaturally(files) {
  return [...files].sort((a, b) => filenameCollator.compare(a.name, b.name));
}

export async function decodeFiles(files, { naturalSort = false } = {}) {
  const accepted = [...files].filter((file) => SUPPORTED.has(file.type) || /\.(png|gif|jpe?g|webp)$/i.test(file.name));
  const rejected = [...files].filter((file) => !accepted.includes(file)).map((file) => `${file.name}: unsupported format`);
  const frames = [];
  const ordered = naturalSort ? sortFilesNaturally(accepted) : accepted;
  for (const file of ordered) {
    try {
      const source = await createImageBitmap(file);
      frames.push({ name: file.name, sourceIndex: frames.length, source, width: source.width, height: source.height });
    } catch { rejected.push(`${file.name}: browser could not decode this image`); }
  }
  return { frames, rejected };
}

export function sliceSheet(sheet, frameW, frameH) {
  if (!sheet?.source || !Number.isInteger(sheet.width) || !Number.isInteger(sheet.height)) throw new TypeError('A decoded source sheet is required.');
  const { columns, rows, frameCount: count } = calculateSheetGrid(sheet.width, sheet.height, frameW, frameH);
  const frames = [];
  for (let index = 0; index < count; index += 1) {
    const source = document.createElement('canvas'); source.width = frameW; source.height = frameH;
    const context = source.getContext('2d');
    if (!context) throw new Error('This browser could not create a 2D canvas context while slicing the sheet.');
    context.imageSmoothingEnabled = false;
    context.drawImage(sheet.source, (index % columns) * frameW, Math.floor(index / columns) * frameH, frameW, frameH, 0, 0, frameW, frameH);
    frames.push({ name: frameName(index, count), sourceIndex: index, source, width: frameW, height: frameH });
  }
  return { frames, rows, columns };
}

export function closeFrames(frames) { frames.forEach((frame) => frame.source instanceof ImageBitmap && frame.source.close()); }
