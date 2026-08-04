import { frameName } from './sprite-processor.js';
import { calculateSheetGrid } from './validation.js';


/**
 * A decoded image or sliced sprite frame.
 *
 * @typedef {object} Frame
 * @property {string} name
 * @property {number} sourceIndex
 * @property {number} width
 * @property {number} height
 * @property {CanvasImageSource} source
 */

/**
 * Result returned after decoding selected image files.
 *
 * @typedef {object} DecodeResult
 * @property {Frame[]} frames
 * @property {string[]} rejected
 */


const SUPPORTED_MIME_TYPES = new Set([
  'image/png',
  'image/gif',
  'image/jpeg',
  'image/webp',
]);

const SUPPORTED_FILE_EXTENSION =
  /\.(png|gif|jpe?g|webp)$/i;

const FILENAME_COLLATOR = new Intl.Collator(
  undefined,
  {
    numeric: true,
    sensitivity: 'base',
  },
);


/**
 * Determine whether a file appears to use a supported image format.
 *
 * File extensions are checked as a fallback because some browsers and
 * operating systems provide an empty or incomplete MIME type.
 *
 * @param {File} file
 * @returns {boolean}
 */
function isSupportedImageFile(file) {
  return (
    SUPPORTED_MIME_TYPES.has(file.type) ||
    SUPPORTED_FILE_EXTENSION.test(file.name)
  );
}

/**
 * Sort files naturally by filename.
 *
 * Numeric segments are compared numerically, producing an order such as
 * `frame2.png` before `frame10.png`.
 *
 * A new array is returned; the supplied collection is not modified.
 *
 * @param {Iterable<File> | ArrayLike<File>} files
 * @returns {File[]}
 */
export function sortFilesNaturally(files) {
  return Array.from(files).sort(
    (firstFile, secondFile) =>
      FILENAME_COLLATOR.compare(
        firstFile.name,
        secondFile.name,
      ),
  );
}

/**
 * Decode selected image files into drawable browser image sources.
 *
 * Unsupported files and files that fail browser decoding are reported
 * separately instead of causing the entire selection to fail.
 *
 * @param {Iterable<File> | ArrayLike<File>} files
 * @param {object} [options]
 * @param {boolean} [options.naturalSort=false]
 * Whether files should be naturally sorted before decoding.
 * @returns {Promise<DecodeResult>}
 */
export async function decodeFiles(
  files,
  {
    naturalSort = false,
  } = {},
) {
  const acceptedFiles = [];
  const rejected = [];

  for (const file of Array.from(files)) {
    if (isSupportedImageFile(file)) {
      acceptedFiles.push(file);
    } else {
      rejected.push(
        `${file.name}: unsupported format`,
      );
    }
  }

  const orderedFiles = naturalSort
    ? sortFilesNaturally(acceptedFiles)
    : acceptedFiles;

  const frames = [];

  for (const file of orderedFiles) {
    try {
      const source = await createImageBitmap(file);

      frames.push({
        name: file.name,
        sourceIndex: frames.length,
        source,
        width: source.width,
        height: source.height,
      });
    } catch {
      rejected.push(
        `${file.name}: browser could not decode this image`,
      );
    }
  }

  return {
    frames,
    rejected,
  };
}

/**
 * Slice a decoded grid sheet into uniform frames in row-major order.
 *
 * @param {Frame} sheet - Decoded source sheet.
 * @param {number} frameWidth - Width of each frame in pixels.
 * @param {number} frameHeight - Height of each frame in pixels.
 * @returns {{
 *   frames: Frame[],
 *   rows: number,
 *   columns: number
 * }}
 * @throws {TypeError} When a decoded source sheet is not supplied.
 * @throws {RangeError} When the frame dimensions do not divide evenly.
 */
export function sliceSheet(
  sheet,
  frameWidth,
  frameHeight,
) {
  const hasDecodedSource =
    sheet?.source &&
    Number.isInteger(sheet.width) &&
    Number.isInteger(sheet.height);

  if (!hasDecodedSource) {
    throw new TypeError(
      'A decoded source sheet is required.',
    );
  }

  const {
    columns,
    rows,
    frameCount,
  } = calculateSheetGrid(
    sheet.width,
    sheet.height,
    frameWidth,
    frameHeight,
  );

  const frames = [];

  for (let index = 0; index < frameCount; index += 1) {
    const row = Math.floor(index / columns);
    const column = index % columns;

    const sourceX = column * frameWidth;
    const sourceY = row * frameHeight;

    const frameCanvas = document.createElement('canvas');

    frameCanvas.width = frameWidth;
    frameCanvas.height = frameHeight;

    const context = frameCanvas.getContext('2d');

    if (!context) {
      throw new Error(
        'This browser could not create a 2D canvas context ' +
        'while slicing the sheet.',
      );
    }

    context.imageSmoothingEnabled = false;

    context.drawImage(
      sheet.source,
      sourceX,
      sourceY,
      frameWidth,
      frameHeight,
      0,
      0,
      frameWidth,
      frameHeight,
    );

    frames.push({
      name: frameName(index, frameCount),
      sourceIndex: index,
      source: frameCanvas,
      width: frameWidth,
      height: frameHeight,
    });
  }

  return {
    frames,
    rows,
    columns,
  };
}

/**
 * Release ImageBitmap resources held by decoded frames.
 *
 * Canvas-backed frames do not require explicit disposal and are left for
 * normal garbage collection.
 *
 * @param {Frame[]} frames
 */
export function closeFrames(frames) {
  const supportsImageBitmap =
    typeof ImageBitmap !== 'undefined';

  if (!supportsImageBitmap) {
    return;
  }

  for (const frame of frames) {
    if (frame.source instanceof ImageBitmap) {
      frame.source.close();
    }
  }
}