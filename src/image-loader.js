import { frameName } from './sprite-processor.js';

const SUPPORTED = new Set(['image/png', 'image/gif', 'image/jpeg', 'image/webp']);

export async function decodeFiles(files) {
  const accepted = [...files].filter((file) => SUPPORTED.has(file.type) || /\.(png|gif|jpe?g|webp)$/i.test(file.name));
  const rejected = [...files].filter((file) => !accepted.includes(file)).map((file) => `${file.name}: unsupported format`);
  const frames = [];
  for (const file of accepted.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    try {
      const source = await createImageBitmap(file);
      frames.push({ name: file.name, sourceIndex: frames.length, source, width: source.width, height: source.height });
    } catch { rejected.push(`${file.name}: browser could not decode this image`); }
  }
  return { frames, rejected };
}

export function sliceSheet(sheet, frameW, frameH) {
  const columns = sheet.width / frameW; const rows = sheet.height / frameH; const count = columns * rows; const frames = [];
  for (let index = 0; index < count; index += 1) {
    const source = document.createElement('canvas'); source.width = frameW; source.height = frameH;
    const context = source.getContext('2d'); context.imageSmoothingEnabled = false;
    context.drawImage(sheet.source, (index % columns) * frameW, Math.floor(index / columns) * frameH, frameW, frameH, 0, 0, frameW, frameH);
    frames.push({ name: frameName(index, count), sourceIndex: index, source, width: frameW, height: frameH });
  }
  return { frames, rows, columns };
}

export function closeFrames(frames) { frames.forEach((frame) => frame.source instanceof ImageBitmap && frame.source.close()); }
