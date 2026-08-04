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
  if (sheetW % frameW || sheetH % frameH) {
    return `Image dimensions ${sheetW}×${sheetH} do not divide evenly into ${frameW}×${frameH} frames.`;
  }
  return '';
}
