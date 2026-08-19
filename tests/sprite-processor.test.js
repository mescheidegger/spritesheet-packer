import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLayout, calculateGeometry, calculateCompactGeometry, centeredPosition, findAlphaBounds, calculateUnionBounds, trimStrategy, createManifest, frameName, scaledDimensions } from '../src/sprite-processor.js';
import { validateInteger, sanitizeBasename, validateSheetDimensions, calculateSheetGrid, suggestFrameDimensions } from '../src/validation.js';
import { sliceSheet, sortFilesNaturally } from '../src/image-loader.js';

test('automatic grid calculation creates a square-ish grid', () => assert.deepEqual(calculateLayout(10, 'grid', 0), { columns: 4, rows: 3 }));
test('explicit columns are capped at the frame count', () => assert.deepEqual(calculateLayout(3, 'grid', 12), { columns: 3, rows: 1 }));
test('row layout places every frame in one row', () => assert.deepEqual(calculateLayout(7, 'row', 2), { columns: 7, rows: 1 }));
test('padding contributes on every side and determines output size', () => assert.deepEqual(calculateGeometry(5, 16, 12, 2, 'grid', 3), { columns: 3, rows: 2, cellW: 16, cellH: 12, fullCellW: 20, fullCellH: 16, sheetW: 60, sheetH: 32 }));
test('frames use integer-floor centering compatible with Python', () => assert.deepEqual(centeredPosition(3, 5, 4, calculateGeometry(4, 10, 9, 1, 'grid', 2), 1), { row: 1, col: 1, x: 15, y: 14 }));
test('invalid zero and negative geometry values throw', () => { assert.throws(() => calculateLayout(0, 'grid', 0)); assert.throws(() => calculateGeometry(1, 0, 1, 0, 'row', 0)); assert.throws(() => calculateGeometry(1, 1, 1, -1, 'row', 0)); });
test('integer validation rejects zero/negative positive fields and permits zero padding', () => { assert.match(validateInteger('0', { label: 'Size' }), /positive/); assert.match(validateInteger('-1', { label: 'Padding', minimum: 0 }), /nonnegative/); assert.equal(validateInteger('0', { label: 'Padding', minimum: 0 }), ''); });
test('alpha bounds find the smallest nontransparent rectangle', () => { const rgba = new Uint8Array(4 * 4 * 3); rgba[(1 * 4 + 1) * 4 + 3] = 1; rgba[(2 * 4 + 3) * 4 + 3] = 255; assert.deepEqual(findAlphaBounds(rgba, 4, 3), { x: 1, y: 1, width: 3, height: 2 }); });
test('fully transparent alpha data returns null', () => assert.equal(findAlphaBounds(new Uint8Array(2 * 2 * 4), 2, 2), null));
test('manifest reports actual centered positions and retains compatible fields', () => { const geometry = calculateGeometry(1, 10, 10, 2, 'grid', 0); const result = createManifest('sprites', { layout: 'grid', columns: 0, padding: 2, trim: true, targetSize: null }, geometry, [{ name: 'a.png', sourceIndex: 4, width: 4, height: 6 }]); assert.deepEqual(result.frames[0], { index: 4, name: 'a.png', row: 0, col: 0, x: 5, y: 4, w: 4, h: 6, cell_w: 10, cell_h: 10, padding: 2 }); assert.equal(result.columns, 'auto'); assert.equal(result.output, 'sprites.png'); });

test('grid manifest includes source sheet input metadata and preserves synthetic frame names', () => {
  const geometry = calculateGeometry(2, 23, 32, 0, 'row', 0);
  const input = { mode: 'sheet', name: 'death-animation.png', width: 184, height: 32, frame_w: 23, frame_h: 32 };
  const result = createManifest('sprites', { layout: 'row', columns: 0, padding: 0, trim: false, targetSize: null }, geometry, [
    { name: 'frame_000.png', sourceIndex: 0, width: 23, height: 32 },
    { name: 'frame_001.png', sourceIndex: 1, width: 23, height: 32 },
  ], input);

  assert.deepEqual(result.input, input);
  assert.deepEqual(result.frames.map((frame) => frame.name), ['frame_000.png', 'frame_001.png']);
  assert.equal(result.output, 'sprites.png');
  assert.equal(result.layout, 'row');
  assert.equal(result.columns, null);
  assert.equal(result.cell_w, 23);
  assert.equal(result.cell_h, 32);
  assert.equal(result.padding, 0);
  assert.equal(result.trim, false);
  assert.equal(result.target_size, null);
  assert.deepEqual(result.frames[0], { index: 0, name: 'frame_000.png', row: 0, col: 0, x: 0, y: 0, w: 23, h: 32, cell_w: 23, cell_h: 32, padding: 0 });
});

test('individual-frame manifest includes input count and keeps naturally ordered filenames', () => {
  const orderedFiles = sortFilesNaturally(['death10.png', 'death2.png', 'death1.png'].map((name) => ({ name })));
  const frames = orderedFiles.map((file, index) => ({ name: file.name, sourceIndex: index, width: 16, height: 16 }));
  const geometry = calculateGeometry(frames.length, 16, 16, 1, 'grid', 2);
  const result = createManifest('sprites', { layout: 'grid', columns: 2, padding: 1, trim: true, targetSize: 16 }, geometry, frames, { mode: 'frames', count: frames.length });

  assert.deepEqual(result.input, { mode: 'frames', count: 3 });
  assert.deepEqual(result.frames.map((frame) => frame.name), ['death1.png', 'death2.png', 'death10.png']);
  assert.deepEqual(result.frames.map((frame) => frame.index), [0, 1, 2]);
  assert.equal(result.columns, 2);
  assert.deepEqual(result.frames[0], { index: 0, name: 'death1.png', row: 0, col: 0, x: 1, y: 1, w: 16, h: 16, cell_w: 16, cell_h: 16, padding: 1 });
});
test('compact frames use actual padded dimensions and authoritative placements', () => {
  const frames = [
    { name: 'frame2.png', sourceIndex: 8, width: 20, height: 8 },
    { name: 'frame10.png', sourceIndex: 9, width: 6, height: 16 },
    { name: 'frame11.png', sourceIndex: 10, width: 9, height: 5 },
  ];
  const geometry = calculateCompactGeometry(frames, 2, 28);
  assert.deepEqual(geometry.placements, [
    { index: 0, x: 0, y: 20, w: 24, h: 12 },
    { index: 1, x: 0, y: 0, w: 10, h: 20 },
    { index: 2, x: 0, y: 32, w: 13, h: 9 },
  ]);
  assert.deepEqual([geometry.sheetW, geometry.sheetH, geometry.maxWidth], [24, 41, 28]);
  const manifest = createManifest('compact', { layout: 'compact', columns: 0, padding: 2, trim: true, targetSize: null }, geometry, frames, { mode: 'frames', count: 3 });
  assert.deepEqual(manifest.frames.map(({ name, x, y }) => ({ name, x, y })), [
    { name: 'frame2.png', x: 2, y: 22 },
    { name: 'frame10.png', x: 2, y: 2 },
    { name: 'frame11.png', x: 2, y: 34 },
  ]);
  assert.deepEqual(manifest.frames[0], { index: 8, name: 'frame2.png', row: null, col: null, x: 2, y: 22, w: 20, h: 8, cell_w: null, cell_h: null, padding: 2 });
  assert.equal(manifest.columns, null);
  assert.equal(manifest.cell_w, null);
  assert.equal(manifest.cell_h, null);
  assert.equal(manifest.max_width, 28);
});
test('compact automatic width includes padding and explicit widths reject the widest packed frame', () => {
  const frames = [{ width: 30, height: 2 }, { width: 2, height: 2 }];
  assert.ok(calculateCompactGeometry(frames, 3, null).maxWidth >= 36);
  assert.throws(() => calculateCompactGeometry(frames, 3, 35), /Maximum output width must be at least 36/);
});
test('sheet frame names are zero padded and ordered', () => assert.deepEqual(Array.from({ length: 3 }, (_, index) => frameName(index, 3)), ['frame_000.png', 'frame_001.png', 'frame_002.png']));
test('scaling allows up/down scaling and preserves aspect ratio', () => { assert.deepEqual(scaledDimensions(8, 4, 16), { width: 16, height: 8 }); assert.deepEqual(scaledDimensions(40, 20, 10), { width: 10, height: 5 }); });
test('sheet division and basename sanitization validate user input', () => { assert.match(validateSheetDimensions(10, 8, 3, 4), /do not divide/); assert.equal(validateSheetDimensions(10, 8, 5, 4), ''); assert.equal(sanitizeBasename('../../bad name.png'), 'bad_name'); assert.equal(sanitizeBasename('...'), 'out_spritesheet'); });
test('512×256 sheet with 64px frames produces the 32-frame regression grid', () => assert.deepEqual(calculateSheetGrid(512, 256, 64, 64), { columns: 8, rows: 4, frameCount: 32 }));
test('sheet grid rejects missing, fractional, zero, negative, oversized, and indivisible frames', () => {
  for (const dimensions of [[undefined, 64], [1.5, 64], [0, 64], [-1, 64], [513, 64], [63, 64]]) {
    assert.throws(() => calculateSheetGrid(512, 256, ...dimensions), RangeError);
  }
});
test('sliceSheet creates 32 separate frame canvases for the regression sheet', () => {
  const originalDocument = globalThis.document;
  const drawCalls = [];
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ imageSmoothingEnabled: true, drawImage: (...args) => drawCalls.push(args) }) }) };
  try {
    const result = sliceSheet({ source: {}, width: 512, height: 256 }, 64, 64);
    assert.equal(result.frames.length, 32);
    assert.deepEqual({ columns: result.columns, rows: result.rows }, { columns: 8, rows: 4 });
    assert.equal(drawCalls.length, 32);
    assert.deepEqual(result.frames.map((frame) => frame.name).slice(0, 2), ['frame_000.png', 'frame_001.png']);
  } finally { globalThis.document = originalDocument; }
});
test('sliceSheet reports a missing 2D canvas context', () => {
  const originalDocument = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => null }) };
  try { assert.throws(() => sliceSheet({ source: {}, width: 64, height: 64 }, 64, 64), /2D canvas context/); }
  finally { globalThis.document = originalDocument; }
});
test('frame dimensions are suggested only for exact square-frame strips', () => {
  assert.deepEqual(suggestFrameDimensions(1024, 128), { width: 128, height: 128 });
  assert.deepEqual(suggestFrameDimensions(128, 1024), { width: 128, height: 128 });
  assert.equal(suggestFrameDimensions(512, 512), null);
  assert.equal(suggestFrameDimensions(1000, 128), null);
});
test('frame dimension suggestions reject invalid source dimensions', () => {
  for (const dimensions of [[0, 128], [-1, 128], [128.5, 128], [128, NaN], [undefined, 128]]) {
    assert.equal(suggestFrameDimensions(...dimensions), null);
  }
});
test('individual filenames use natural numeric ordering', () => {
  const files = ['death10.png', 'death2.png', 'death1.png'].map((name) => ({ name }));
  assert.deepEqual(sortFilesNaturally(files).map((file) => file.name), ['death1.png', 'death2.png', 'death10.png']);
});
test('natural filename ordering is case insensitive', () => {
  const files = ['Death10.png', 'death2.png', 'DEATH1.png'].map((name) => ({ name }));
  assert.deepEqual(sortFilesNaturally(files).map((file) => file.name), ['DEATH1.png', 'death2.png', 'Death10.png']);
});
test('union bounds retain a shared coordinate system for standing and fallen poses', () => {
  const standing = { x: 4, y: 0, width: 2, height: 10 };
  const fallen = { x: 0, y: 8, width: 10, height: 2 };
  assert.deepEqual(calculateUnionBounds([standing, fallen]), { x: 0, y: 0, width: 10, height: 10 });
});
test('transparent frames do not invalidate visible shared bounds', () => {
  assert.deepEqual(calculateUnionBounds([null, { x: 2, y: 3, width: 4, height: 5 }]), { x: 2, y: 3, width: 4, height: 5 });
});
test('fully transparent batches have no union and matching frames use shared trim', () => {
  assert.equal(calculateUnionBounds([null, null]), null);
  assert.equal(trimStrategy([{ width: 16, height: 16 }, { width: 16, height: 16 }], true), 'shared');
});
test('mismatched frame dimensions use per-frame trim fallback', () => {
  assert.equal(trimStrategy([{ width: 16, height: 16 }, { width: 32, height: 16 }], true), 'per-frame');
  assert.equal(trimStrategy([{ width: 16, height: 16 }], false), 'none');
});
