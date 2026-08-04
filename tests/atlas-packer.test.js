import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateAtlasLayout, createAtlasManifest } from '../src/atlas-packer.js';

const items = [
  { name: 'a.png', width: 10, height: 20 },
  { name: 'b.png', width: 30, height: 10 },
  { name: 'c.png', width: 12, height: 12 },
];

function overlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
    a.y < b.y + b.h && a.y + a.h > b.y;
}

function assertInside(layout) {
  for (const p of layout.placements) {
    assert.ok(p.x >= 0 && p.y >= 0);
    assert.ok(p.x + p.w <= layout.width);
    assert.ok(p.y + p.h <= layout.height);
  }
}

test('horizontal preserves order, top alignment, dimensions, and gaps', () => {
  const layout = calculateAtlasLayout(items, { layout: 'horizontal', gap: 4 });
  assert.deepEqual(layout.placements.map(({ x, y }) => ({ x, y })),
    [{ x: 0, y: 0 }, { x: 14, y: 0 }, { x: 48, y: 0 }]);
  assert.equal(layout.width, 60); assert.equal(layout.height, 20);
  assert.deepEqual([layout.rows, layout.columns], [1, 3]);
});

test('vertical preserves order, left alignment, dimensions, and gaps', () => {
  const layout = calculateAtlasLayout(items, { layout: 'vertical', gap: 3 });
  assert.deepEqual(layout.placements.map(({ x, y }) => ({ x, y })),
    [{ x: 0, y: 0 }, { x: 0, y: 23 }, { x: 0, y: 36 }]);
  assert.equal(layout.width, 30); assert.equal(layout.height, 48);
  assert.deepEqual([layout.rows, layout.columns], [3, 1]);
});

test('grid supports automatic columns and centers variable sheets', () => {
  const layout = calculateAtlasLayout(items, { layout: 'grid', gap: 2 });
  assert.deepEqual([layout.rows, layout.columns, layout.width, layout.height], [2, 2, 62, 42]);
  assert.deepEqual(layout.placements[0], { index: 0, x: 10, y: 0, w: 10, h: 20 });
  assert.deepEqual(layout.placements[1], { index: 1, x: 32, y: 5, w: 30, h: 10 });
  assert.deepEqual(layout.placements[2], { index: 2, x: 9, y: 26, w: 12, h: 12 });
});

test('grid honors explicit columns', () => {
  const layout = calculateAtlasLayout(items, { layout: 'grid', columns: 3, gap: 5 });
  assert.deepEqual([layout.rows, layout.columns, layout.width, layout.height], [1, 3, 100, 20]);
});

test('compact is deterministic, bounded, nonoverlapping, and retains original indexes', () => {
  const options = { layout: 'compact', gap: 4, maxWidth: 44 };
  const first = calculateAtlasLayout(items, options);
  const second = calculateAtlasLayout(items, options);
  assert.deepEqual(first, second);
  assert.ok(first.width <= 44);
  assert.deepEqual(first.placements.map((p) => p.index), [0, 1, 2]);
  assertInside(first);
  for (let i = 0; i < first.placements.length; i += 1) {
    for (let j = i + 1; j < first.placements.length; j += 1) {
      assert.equal(overlap(first.placements[i], first.placements[j]), false);
    }
  }
});

test('derived compact width is never narrower than widest input', () => {
  const layout = calculateAtlasLayout(items, { layout: 'compact', gap: 0 });
  assert.ok(layout.maxWidth >= 30);
  assertInside(layout);
});

test('rejects empty inputs and invalid dimensions and options', () => {
  assert.throws(() => calculateAtlasLayout([], { layout: 'grid' }), /At least one/);
  for (const bad of [0, -1, 1.5, NaN]) {
    assert.throws(() => calculateAtlasLayout([{ width: bad, height: 2 }], { layout: 'horizontal' }), /dimensions/);
  }
  assert.throws(() => calculateAtlasLayout(items, { layout: 'grid', gap: -1 }), /Gap/);
  assert.throws(() => calculateAtlasLayout(items, { layout: 'grid', columns: 1.5 }), /Columns/);
  assert.throws(() => calculateAtlasLayout(items, { layout: 'compact', maxWidth: 29 }), /at least 30/);
  assert.throws(() => calculateAtlasLayout(items, { layout: 'compact', maxWidth: 0 }), /positive integer/);
  assert.throws(() => calculateAtlasLayout(items, { layout: 'unknown' }), /Atlas layout/);
});

test('creates the sheet-level atlas manifest with effective geometry', () => {
  const layout = calculateAtlasLayout(items, { layout: 'compact', gap: 4, maxWidth: 44 });
  const manifest = createAtlasManifest('combined_atlas', {}, layout);
  assert.equal(manifest.output, 'combined_atlas.png');
  assert.equal(manifest.type, 'atlas');
  assert.equal(manifest.layout, 'compact');
  assert.equal(manifest.max_width, 44);
  assert.equal(manifest.rows, null); assert.equal(manifest.columns, null);
  assert.deepEqual(manifest.sheets[0], { index: 0, name: 'a.png', ...layout.placements[0] });
});
