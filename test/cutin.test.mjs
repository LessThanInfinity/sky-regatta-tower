import test from "node:test";
import assert from "node:assert/strict";
import { isCrit, buildCutInData, playCritCutIn } from "../scripts/cutin.mjs";

const actor = (config) => ({ uuid: "Actor.abc", getFlag: (mod, key) => (mod === "cinematic-cut-ins" && key === "config" ? config : undefined) });
const mgr = { applyRandomization: (d) => ({ ...d, randomized: true }), processText: (t) => t.toUpperCase() };

test("only a critical success counts as a crit", () => {
  assert.equal(isCrit("critSuccess"), true);
  assert.equal(isCrit("success"), false);
  assert.equal(isCrit("critFailure"), false);
  assert.equal(isCrit(["failure", "critSuccess", "success"]), true);   // any check in the Narrows
  assert.equal(isCrit(["success", "failure"]), false);
  assert.equal(isCrit(undefined), false);
});

test("builds playable data from the actor's own config", () => {
  const d = buildCutInData(actor({ text: "crit", img: "x.png" }), mgr);
  assert.equal(d.actorId, "Actor.abc");
  assert.equal(d.text, "CRIT");
  assert.equal(d.randomized, true);
  assert.deepEqual(d.layers, []);
});

test("an actor with no cut-in config gives nothing", () => {
  assert.equal(buildCutInData(actor(undefined), mgr), null);
  assert.equal(buildCutInData(actor({}), mgr), null);
  assert.equal(buildCutInData(null, mgr), null);
});

test("plays for everyone through the module API, and says why it skipped otherwise", () => {
  const played = [];
  const api = { play: (d) => played.push(d), CutinManager: mgr };
  assert.equal(playCritCutIn(actor({ text: "hi" }), api), "played");
  assert.equal(played.length, 1);
  assert.equal(playCritCutIn(actor({ text: "hi" }), undefined), "no-module");
  assert.equal(playCritCutIn(null, api), "no-actor");
  assert.equal(playCritCutIn(actor(undefined), api), "no-config");
  assert.equal(played.length, 1);
});
