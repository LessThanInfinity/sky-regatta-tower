import test from "node:test";
import assert from "node:assert/strict";
import { benchAuras } from "../scripts/benchfx.mjs";

const act = (degree, extra = {}) => ({ action: "spotter", rider: "violet", degree, benchId: "b1", lap: 1, key: "A", nat: 12, total: 30, ...extra });
const st = (...acts) => ({ bench: { acts: Object.fromEntries(acts.map((a, i) => [a.benchId + i, a])) } });

test("spotter success, crit and crit failure map to tones; plain failure shows nothing", () => {
  assert.equal(benchAuras(st(act("success"))).violet.tone, "good");
  assert.equal(benchAuras(st(act("critSuccess"))).violet.tone, "great");
  assert.equal(benchAuras(st(act("critFailure"))).violet.tone, "bad");
  assert.deepEqual(benchAuras(st(act("failure"))), {});
});

test("other bench actions and empty state give no aura", () => {
  assert.deepEqual(benchAuras(st(act("success", { action: "pit" }))), {});
  assert.deepEqual(benchAuras({}), {});
  assert.deepEqual(benchAuras(null), {});
});

test("two spotters on one rider: the better result wins; a new roll changes the key", () => {
  assert.equal(benchAuras(st(act("critFailure"), act("success", { benchId: "b2" }))).violet.tone, "good");
  assert.notEqual(benchAuras(st(act("success"))).violet.key, benchAuras(st(act("success", { nat: 13 }))).violet.key);
});

test("the aura clears once that rider has rolled", () => {
  const s = st(act("success"), act("critFailure", { rider: "aji", benchId: "b2" }));
  assert.deepEqual(Object.keys(benchAuras(s)).sort(), ["aji", "violet"]);
  s.pending = { violet: { total: 20 } };
  assert.deepEqual(Object.keys(benchAuras(s)), ["aji"]);
});
