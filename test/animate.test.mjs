import test from "node:test";
import assert from "node:assert/strict";
import { computeSlides, captureTops, playSlides } from "../scripts/animate.mjs";

test("rows that moved get an offset equal to how far they travelled", () => {
  const prev = { a: 100, b: 140, c: 180 };
  const next = { a: 140, b: 100, c: 180 };            // a and b swapped
  const slides = computeSlides(prev, next);
  assert.deepEqual(slides, [{ id: "a", dy: -40 }, { id: "b", dy: 40 }]);
});

test("positive dy means the row rose (it used to be lower)", () => {
  assert.equal(computeSlides({ x: 200 }, { x: 160 })[0].dy, 40);
});

test("rows that didn't move or are new are skipped", () => {
  assert.deepEqual(computeSlides({ a: 100 }, { a: 100, b: 140 }), []);
  assert.deepEqual(computeSlides(null, { a: 1 }), []);
  assert.deepEqual(computeSlides({ a: 100 }, { a: 100.4 }), []);   // sub-pixel jitter
});

test("capture and play are safe with no DOM or no earlier positions", () => {
  assert.deepEqual(captureTops(null), {});
  assert.equal(playSlides(null, {}), 0);
  assert.equal(playSlides({}, null), 0);
});
