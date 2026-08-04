import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateLayout, calculateGeometry, centeredPosition, findAlphaBounds, createManifest, frameName, scaledDimensions } from '../src/sprite-processor.js';
import { validateInteger, sanitizeBasename, validateSheetDimensions } from '../src/validation.js';

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
test('sheet frame names are zero padded and ordered', () => assert.deepEqual(Array.from({ length: 3 }, (_, index) => frameName(index, 3)), ['frame_000.png', 'frame_001.png', 'frame_002.png']));
test('scaling allows up/down scaling and preserves aspect ratio', () => { assert.deepEqual(scaledDimensions(8, 4, 16), { width: 16, height: 8 }); assert.deepEqual(scaledDimensions(40, 20, 10), { width: 10, height: 5 }); });
test('sheet division and basename sanitization validate user input', () => { assert.match(validateSheetDimensions(10, 8, 3, 4), /do not divide/); assert.equal(validateSheetDimensions(10, 8, 5, 4), ''); assert.equal(sanitizeBasename('../../bad name.png'), 'bad_name'); assert.equal(sanitizeBasename('...'), 'out_spritesheet'); });
