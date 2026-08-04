/** Return an error message for an integer field, or an empty string when valid. */
export function validateInteger(value, { label, minimum = 1, optional = false }) {
  if (optional && String(value).trim() === '') return '';
  if (String(value).trim() === '') return `${label} is required.`;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) {
    return `${label} must be ${minimum === 0 ? 'a nonnegative' : 'a positive'} integer.`;
  }
  return '';
}

export function sanitizeBasename(value) {
  const leaf = String(value).trim().split(/[\\/]/).pop() || '';
  const cleaned = leaf.replace(/\.(png|json)$/i, '').replace(/[^a-z0-9._-]+/gi, '_').replace(/^[._-]+|[._-]+$/g, '');
  return cleaned || 'out_spritesheet';
}

export function validateSheetDimensions(sheetW, sheetH, frameW, frameH) {
  if (!Number.isInteger(frameW) || !Number.isInteger(frameH) || frameW <= 0 || frameH <= 0) {
    return 'Frame width and height must be positive integers.';
  }
  if (frameW > sheetW || frameH > sheetH) {
    return `Frame dimensions ${frameW}×${frameH} cannot exceed source dimensions ${sheetW}×${sheetH}.`;
  }
  if (sheetW % frameW || sheetH % frameH) {
    return `Image dimensions ${sheetW}×${sheetH} do not divide evenly into ${frameW}×${frameH} frames.`;
  }
  return '';
}

export function calculateSheetGrid(sheetW, sheetH, frameW, frameH) {
  const error = validateSheetDimensions(sheetW, sheetH, frameW, frameH);
  if (error) throw new RangeError(error);
  const columns = sheetW / frameW;
  const rows = sheetH / frameH;
  return { columns, rows, frameCount: columns * rows };
}
