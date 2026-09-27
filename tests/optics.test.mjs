import test from 'node:test';
import assert from 'node:assert/strict';
import { imageDistance, imagePoint, rayThroughAperture } from '../optics.js';

const center = { x: 0, y: 2.04, z: 0 };
const objects = [
  { x: 9.4, y: 3.05, z: .82 },
  { x: 9.4, y: .72, z: -1.48 },
];
const aperture = [[0,0],[.42,0],[-.42,0],[0,.42],[0,-.42],[.29,.29],[-.29,-.29]];

test('sete zonas da lente levam ao mesmo ponto do sensor para cada objeto', () => {
  for (const mm of [35, 50, 85]) {
    const f = mm / 45, u = 9.4;
    const expectedV = imageDistance(f, u);
    assert.ok(Math.abs(1 / f - 1 / u - 1 / expectedV) < 1e-12);
    for (const point of objects) {
      const expected = imagePoint(point, center, f);
      assert.ok(Math.abs(expected.x + expectedV) < 1e-12);
      assert.ok(Math.abs(expected.y - center.y) < .5875);
      assert.ok(Math.abs(expected.z - center.z) < .94);
      for (const [dy,dz] of aperture) {
        const ray = rayThroughAperture(point, center, f, dy, dz);
        assert.deepEqual(ray.to, expected);
        assert.equal(ray.through.x, center.x);
        for (const coordinate of ['y','z']) {
          const incomingSlope = (ray.through[coordinate] - ray.from[coordinate]) / (ray.through.x - ray.from.x);
          const outgoingSlope = (ray.to[coordinate] - ray.through[coordinate]) / (ray.to.x - ray.through.x);
          const expectedChange = (ray.through[coordinate] - center[coordinate]) / f;
          assert.ok(Math.abs(outgoingSlope - incomingSlope - expectedChange) < 1e-12);
        }
      }
    }
  }
});

test('a imagem é invertida nos dois eixos e só há imagem real para u > f', () => {
  const a = imagePoint(objects[0], center, 50/45);
  const b = imagePoint(objects[1], center, 50/45);
  assert.ok(a.y < center.y && a.z < center.z);
  assert.ok(b.y > center.y && b.z > center.z);
  assert.throws(() => imageDistance(2, 1.5), RangeError);
});

test('mover apenas a lente altera a imagem e preserva a convergência dos raios', () => {
  const moved = { x: 1.2, y: 2.64, z: -.6 };
  const fixedIslandPoint = objects[0];
  const f = 50 / 45;
  const original = imagePoint(fixedIslandPoint, center, f);
  const translated = imagePoint(fixedIslandPoint, moved, f);
  assert.notDeepEqual(translated, original);
  const v = imageDistance(f, fixedIslandPoint.x - moved.x);
  assert.ok(Math.abs(translated.x - (moved.x - v)) < 1e-12);
  for (const [dy, dz] of aperture) {
    const ray = rayThroughAperture(fixedIslandPoint, moved, f, dy, dz);
    assert.deepEqual(ray.to, translated);
    assert.equal(ray.through.y, moved.y + dy);
    assert.equal(ray.through.z, moved.z + dz);
  }
  assert.deepEqual(fixedIslandPoint, objects[0]);
});
