import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RESOURCE_LIMITS,
  assertSafeInteger,
  formatBytes,
  imagePixelCount,
  safeMultiply,
  validateCanvasAllocation,
  validateDecodedImage,
  validateFiles,
  validateFrameCount,
  validateSheetSlicingPlan,
  validateTotalDecodedPixels,
} from '../src/resource-limits.js';
import { calculateAtlasLayout } from '../src/atlas-packer.js';
import { calculateGeometry } from '../src/sprite-processor.js';

const file = (name, size) => ({ name, size, type: 'image/png' });

test('file count accepts the exact maximum and rejects one over', () => {
  assert.equal(validateFiles(Array.from({ length: RESOURCE_LIMITS.maxFiles }, (_, i) => file(`${i}.png`, 1))).count, RESOURCE_LIMITS.maxFiles);
  assert.throws(() => validateFiles(Array.from({ length: RESOURCE_LIMITS.maxFiles + 1 }, (_, i) => file(`${i}.png`, 1))), /maximum is 512/);
});

test('single file bytes accept exact maximum and reject one byte over', () => {
  assert.equal(validateFiles([file('hero.png', RESOURCE_LIMITS.maxFileBytes)]).bytes, RESOURCE_LIMITS.maxFileBytes);
  assert.throws(() => validateFiles([file('hero-sheet.png', RESOURCE_LIMITS.maxFileBytes + 1)]), /hero-sheet\.png.*maximum file size/);
});

test('total file bytes accept exact maximum and reject one byte over', () => {
  assert.equal(validateFiles(['a.png', 'b.png', 'c.png', 'd.png'].map((name) => file(name, RESOURCE_LIMITS.maxFileBytes))).bytes, RESOURCE_LIMITS.maxTotalFileBytes);
  assert.throws(() => validateFiles([file('a.png', RESOURCE_LIMITS.maxFileBytes), file('b.png', RESOURCE_LIMITS.maxFileBytes), file('c.png', RESOURCE_LIMITS.maxFileBytes), file('d.png', RESOURCE_LIMITS.maxFileBytes), file('e.png', 1)]), /maximum combined file size/);
});

test('decoded image dimensions and pixels enforce exact boundaries', () => {
  assert.equal(validateDecodedImage('edge.png', RESOURCE_LIMITS.maxImageDimension, 1).pixels, RESOURCE_LIMITS.maxImageDimension);
  assert.throws(() => validateDecodedImage('wide.png', RESOURCE_LIMITS.maxImageDimension + 1, 1), /maximum image dimension/);
  assert.equal(validateDecodedImage('pixels.png', 8000, 4000).pixels, RESOURCE_LIMITS.maxImagePixels);
  assert.throws(() => validateDecodedImage('pixels.png', 8000, 4001), /maximum is 32,000,000/);
});

test('cumulative decoded pixels accept exact maximum and reject one over', () => {
  assert.equal(validateTotalDecodedPixels(RESOURCE_LIMITS.maxTotalDecodedPixels - 1, 1), RESOURCE_LIMITS.maxTotalDecodedPixels);
  assert.throws(() => validateTotalDecodedPixels(RESOURCE_LIMITS.maxTotalDecodedPixels, 1), /maximum is 64,000,000/);
});

test('frame count accepts exact maximum and rejects one over', () => {
  assert.equal(validateFrameCount(RESOURCE_LIMITS.maxFrameCount), RESOURCE_LIMITS.maxFrameCount);
  assert.throws(() => validateFrameCount(RESOURCE_LIMITS.maxFrameCount + 1), /maximum is 2,048/);
});

test('output dimensions, pixels, and RGBA byte estimates are bounded', () => {
  assert.equal(validateCanvasAllocation(RESOURCE_LIMITS.maxOutputDimension, 1).rgbaBytes, RESOURCE_LIMITS.maxOutputDimension * 4);
  assert.throws(() => validateCanvasAllocation(RESOURCE_LIMITS.maxOutputDimension + 1, 1), /maximum output dimension/);
  assert.equal(validateCanvasAllocation(8000, 4000).pixels, RESOURCE_LIMITS.maxOutputPixels);
  assert.equal(validateCanvasAllocation(8000, 4000).rgbaBytes, 128000000);
  assert.throws(() => validateCanvasAllocation(8000, 4001), /maximum output size/);
});

test('unsafe arithmetic rejects non-finite, fractional, negative, zero, and unsafe inputs', () => {
  for (const bad of [Infinity, NaN, 1.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => assertSafeInteger('Bad', bad), /safe integer/);
  }
  assert.throws(() => imagePixelCount(0, 1), /at least 1/);
  assert.throws(() => safeMultiply('Overflow', Number.MAX_SAFE_INTEGER, 2), /safe integer/);
});

test('sheet slicing and ZIP preflight use the frame-count policy before canvases', () => {
  assert.deepEqual(validateSheetSlicingPlan(2048, 1024, 32, 32), { columns: 64, rows: 32, frameCount: 2048 });
  assert.throws(() => validateSheetSlicingPlan(2048, 1056, 32, 32), /maximum is 2,048/);
});

test('horizontal and vertical atlas layouts reject excessive dimensions', () => {
  assert.throws(() => calculateAtlasLayout([{ name: 'a', width: 16000, height: 1 }, { name: 'b', width: 1000, height: 1 }], { layout: 'horizontal' }), /maximum output dimension/);
  assert.throws(() => calculateAtlasLayout([{ name: 'a', width: 1, height: 16000 }, { name: 'b', width: 1, height: 1000 }], { layout: 'vertical' }), /maximum output dimension/);
});

test('grid and compact atlas layouts reject excessive total pixels', () => {
  const big = [{ name: 'a', width: 8000, height: 2000 }, { name: 'b', width: 8000, height: 2000 }, { name: 'c', width: 8000, height: 1 }];
  assert.throws(() => calculateAtlasLayout(big, { layout: 'grid', columns: 1 }), /maximum output size/);
  assert.throws(() => calculateAtlasLayout(big, { layout: 'compact', maxWidth: 8000 }), /maximum output size/);
});

test('valid normal-sized sheets, frames, atlases, and formatting remain unchanged', () => {
  assert.deepEqual(calculateGeometry(5, 16, 12, 2, 'grid', 3), { columns: 3, rows: 2, cellW: 16, cellH: 12, fullCellW: 20, fullCellH: 16, sheetW: 60, sheetH: 32 });
  assert.equal(calculateAtlasLayout([{ name: 'a', width: 10, height: 20 }, { name: 'b', width: 30, height: 10 }], { layout: 'horizontal', gap: 4 }).width, 44);
  assert.equal(formatBytes(25 * 1024 * 1024), '25 MiB');
});
