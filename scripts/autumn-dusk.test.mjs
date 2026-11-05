import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { AutumnDusk, SeededRandom, WIDTH, HEIGHT, DUSK_SECONDS } from '../src/lib/autumn-dusk.ts';
const frame = (scene, time) => {
  const canvas = createCanvas(WIDTH, HEIGHT);
  scene.render(canvas.getContext('2d'), time);
  return canvas.getContext('2d').getImageData(0, 0, WIDTH, HEIGHT).data;
};
const hash = pixels => createHash('sha256').update(pixels).digest('hex');
test('the Java random generator preserves the known seed-zero sequence', () => {
  const rng = new SeededRandom(0);
  assert.equal(rng.next(), 0.7309677600860596);
  assert.equal(rng.next(), 0.8314409852027893);
});
test('restart restores the original frame; time and a new seed change it', () => {
  const scene = new AutumnDusk(241, createCanvas);
  assert.equal(scene.twigs.length, 53);
  assert.equal(scene.leaves.length, 196);
  const initial = frame(scene, 0);
  const later = frame(scene, DUSK_SECONDS / 2);
  assert.notEqual(hash(initial), hash(later));
  assert.equal(hash(frame(scene, 0)), hash(initial));
  assert.equal(hash(frame(new AutumnDusk(241, createCanvas), 0)), hash(initial));
  assert.notEqual(hash(frame(new AutumnDusk(242, createCanvas), 0)), hash(initial));
  // The unoccupied upper-center sky darkens at the midpoint, as in the PDE.
  const index = (100 * WIDTH + 600) * 4;
  assert.ok(later[index] < initial[index] - 30);
  assert.ok(initial.every((value, i) => i % 4 !== 3 || value === 255));
  assert.throws(() => frame(scene, NaN), RangeError);
  assert.equal(scene.leaves.length, 196); // Rendering does not accumulate leaves/trails.
});
test('downloaded Processing source is unchanged from the supplied attachment', () => {
  assert.equal(hash(readFileSync('public/artworks/autumn-dusk/AutumnDusk.pde')), '0343f8ca3bd7b55ffc8b5ad4726149335a229bf9a9551f5e3b54ead7b45f197e');
});
