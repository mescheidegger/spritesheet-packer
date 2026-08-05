import { assertSafeInteger, safeMultiply } from './resource-limits.js';
const DEFAULT_BASENAME = 'out_spritesheet';
const OUTPUT_EXTENSION_PATTERN = /\.(png|json)$/i;
const INVALID_BASENAME_CHARACTERS = /[^a-z0-9._-]+/gi;
const EDGE_PUNCTUATION = /^[._-]+|[._-]+$/g;

/**
 * Validate a field that should contain an integer.
 *
 * @param {string|number} value - Raw field value.
 * @param {object} options - Validation options.
 * @param {string} options.label - User-facing field label.
 * @param {number} [options.minimum=1] - Smallest accepted integer.
 * @param {boolean} [options.optional=false] - Whether an empty value is valid.
 * @returns {string} An error message, or an empty string when valid.
 */
export function validateInteger(
  value,
  {
    label,
    minimum = 1,
    optional = false,
  },
) {
  const normalizedValue = String(value).trim();

  if (normalizedValue === '') {
    return optional ? '' : `${label} is required.`;
  }

  const numericValue = Number(normalizedValue);

  if (Number.isInteger(numericValue) && numericValue >= minimum) {
    return '';
  }

  let requirement;

  if (minimum === 0) {
    requirement = 'a nonnegative integer';
  } else if (minimum === 1) {
    requirement = 'a positive integer';
  } else {
    requirement = `an integer greater than or equal to ${minimum}`;
  }

  return `${label} must be ${requirement}.`;
}

/**
 * Convert a user-provided output name into a safe filename basename.
 *
 * Directory components and supported output extensions are removed.
 * Unsupported characters are replaced with underscores.
 *
 * @param {unknown} value - User-provided output name.
 * @returns {string} A sanitized basename without a file extension.
 */
export function sanitizeBasename(value) {
  const pathSegments = String(value).trim().split(/[\\/]/);
  const filename = pathSegments.pop() || '';

  const withoutExtension = filename.replace(
    OUTPUT_EXTENSION_PATTERN,
    '',
  );

  const normalizedCharacters = withoutExtension.replace(
    INVALID_BASENAME_CHARACTERS,
    '_',
  );

  const cleanedBasename = normalizedCharacters.replace(
    EDGE_PUNCTUATION,
    '',
  );

  return cleanedBasename || DEFAULT_BASENAME;
}

/**
 * Validate that a source sheet can be divided evenly into frames.
 *
 * @param {number} sheetWidth - Source-sheet width in pixels.
 * @param {number} sheetHeight - Source-sheet height in pixels.
 * @param {number} frameWidth - Width of one frame in pixels.
 * @param {number} frameHeight - Height of one frame in pixels.
 * @returns {string} An error message, or an empty string when valid.
 */
export function validateSheetDimensions(
  sheetWidth,
  sheetHeight,
  frameWidth,
  frameHeight,
) {
  const frameDimensionsAreValid =
    Number.isInteger(frameWidth) &&
    Number.isInteger(frameHeight) &&
    frameWidth > 0 &&
    frameHeight > 0;

  if (!frameDimensionsAreValid) {
    return 'Frame width and height must be positive integers.';
  }

  if (frameWidth > sheetWidth || frameHeight > sheetHeight) {
    return (
      `Frame dimensions ${frameWidth}×${frameHeight} cannot exceed ` +
      `source dimensions ${sheetWidth}×${sheetHeight}.`
    );
  }

  const dividesEvenly =
    sheetWidth % frameWidth === 0 &&
    sheetHeight % frameHeight === 0;

  if (!dividesEvenly) {
    return (
      `Image dimensions ${sheetWidth}×${sheetHeight} do not divide ` +
      `evenly into ${frameWidth}×${frameHeight} frames.`
    );
  }

  return '';
}

/**
 * Calculate the grid produced by slicing a source sheet into uniform frames.
 *
 * @param {number} sheetWidth - Source-sheet width in pixels.
 * @param {number} sheetHeight - Source-sheet height in pixels.
 * @param {number} frameWidth - Width of one frame in pixels.
 * @param {number} frameHeight - Height of one frame in pixels.
 * @returns {{columns: number, rows: number, frameCount: number}}
 * Grid dimensions and total frame count.
 * @throws {RangeError} When the frame dimensions are invalid.
 */
export function calculateSheetGrid(
  sheetWidth,
  sheetHeight,
  frameWidth,
  frameHeight,
) {
  const validationError = validateSheetDimensions(
    sheetWidth,
    sheetHeight,
    frameWidth,
    frameHeight,
  );

  if (validationError) {
    throw new RangeError(validationError);
  }

  const columns = sheetWidth / frameWidth;
  const rows = sheetHeight / frameHeight;

  assertSafeInteger('Sheet columns', columns, { minimum: 1 });
  assertSafeInteger('Sheet rows', rows, { minimum: 1 });

  return {
    columns,
    rows,
    frameCount: safeMultiply('Frame count', columns, rows),
  };
}

/**
 * Suggest square frame dimensions for an apparent single-row or
 * single-column sprite strip.
 *
 * This is intentionally conservative. Square or ambiguous sheets do not
 * receive a suggestion because their intended grid cannot be inferred.
 *
 * @param {number} sourceWidth - Source-sheet width in pixels.
 * @param {number} sourceHeight - Source-sheet height in pixels.
 * @returns {{width: number, height: number} | null}
 * Suggested frame dimensions, or `null` when no reliable suggestion exists.
 */
export function suggestFrameDimensions(
  sourceWidth,
  sourceHeight,
) {
  const sourceDimensionsAreValid =
    Number.isInteger(sourceWidth) &&
    Number.isInteger(sourceHeight) &&
    sourceWidth > 0 &&
    sourceHeight > 0;

  if (!sourceDimensionsAreValid) {
    return null;
  }

  const isHorizontalStrip =
    sourceWidth > sourceHeight &&
    sourceWidth % sourceHeight === 0;

  if (isHorizontalStrip) {
    return {
      width: sourceHeight,
      height: sourceHeight,
    };
  }

  const isVerticalStrip =
    sourceHeight > sourceWidth &&
    sourceHeight % sourceWidth === 0;

  if (isVerticalStrip) {
    return {
      width: sourceWidth,
      height: sourceWidth,
    };
  }

  return null;
}