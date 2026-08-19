import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateCompactRectangles } from '../src/rectangle-packer.js';

test('shared compact primitive is deterministic, bounded, and nonoverlapping', () => {
  const items = [{ width: 10, height: 20 }, { width: 30, height: 10 }, { width: 12, height: 12 }];
  const first = calculateCompactRectangles(items, { gap: 4, maxWidth: 44 });
  assert.deepEqual(first, calculateCompactRectangles(items, { gap: 4, maxWidth: 44 }));
  for (const placement of first.placements) {
    assert.ok(placement.x + placement.w <= first.width);
    assert.ok(placement.y + placement.h <= first.height);
  }
  for (let i = 0; i < first.placements.length; i += 1) {
    for (let j = i + 1; j < first.placements.length; j += 1) {
      const a = first.placements[i]; const b = first.placements[j];
      assert.equal(a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y, false);
    }
  }
});
