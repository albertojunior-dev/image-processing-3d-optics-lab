import test from 'node:test';
import assert from 'node:assert/strict';
import { orientPixels } from '../image-processing.js';

test('sensor and finished photograph have opposite orientations', () => {
  // Framebuffer reads the bottom row first: C D / A B in memory.
  const readback = new Uint8Array([
    30, 0, 0, 255, 40, 0, 0, 255,
    10, 0, 0, 255, 20, 0, 0, 255,
  ]);
  const reds = data => [data[0], data[4], data[8], data[12]];
  assert.deepEqual(reds(orientPixels(readback, 2, 2, false)), [10, 20, 30, 40]);
  assert.deepEqual(reds(orientPixels(readback, 2, 2, true)), [40, 30, 20, 10]);
});

test('grayscale uses RGB luminance, preserving an opaque alpha channel', () => {
  const result = orientPixels(new Uint8Array([100, 200, 50, 0]), 1, 1, false, true);
  assert.deepEqual([...result], [168, 168, 168, 255]);
});
