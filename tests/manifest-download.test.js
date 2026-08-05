import assert from 'node:assert/strict';
import test from 'node:test';

import { createDownloadableManifest } from '../src/manifest-download.js';

test('downloadable manifest updates only the output filename for a new basename', () => {
  const manifest = {
    output: 'original.png',
    width: 32,
    height: 16,
    frames: [
      { index: 0, name: 'idle.png', x: 0, y: 0, w: 16, h: 16 },
    ],
  };
  const canvasState = { width: 32, height: 16 };
  const blobState = { type: 'image/png', size: 128 };

  const downloadable = createDownloadableManifest(manifest, 'renamed_sheet');

  assert.deepEqual(downloadable, {
    ...manifest,
    output: 'renamed_sheet.png',
  });
  assert.equal(manifest.output, 'original.png');
  assert.equal(downloadable.frames, manifest.frames);
  assert.deepEqual(canvasState, { width: 32, height: 16 });
  assert.deepEqual(blobState, { type: 'image/png', size: 128 });
});
