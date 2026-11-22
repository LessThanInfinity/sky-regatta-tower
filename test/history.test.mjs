import test from "node:test";
import assert from "node:assert/strict";
import {
  freshState, resolveSection, undo, replay, undoneDice, setVp, makeRecorder, ROSTER, clone,
} from "../scripts/engine.mjs";
import { towerContext } from "../scripts/view.mjs";
import { ROLL_MODES, normalizeMode, visibility } from "../scripts/rollmode.mjs";

const fakeD6 = (seq) => { let i = 0; return async () => seq[i++ % seq.length]; };
const vpOf = (s) => Object.fromEntries(ROSTER.map((r) => [r.id, s.vp[r.id]]));

/** Runs sections with a recorder, the way main.mjs does, and keeps the dice with the result. */
async function roll(state, input = {}, d6, replayDice = null, extra = {}) {
  const dice = makeRecorder(d6, replayDice, extra.rand);
  const report = await resolveSection(state, input, dice.d6, { npcBench: 0.5, rand: dice.rand });
  state.lastDice = dice.rec;
  return report;
}
const randomD6 = async () => 1 + Math.floor(Math.random() * 6);

test("replay brings back exactly the section that was undone", async () => {
  let s = freshState();
  await roll(s, { violet: 2, aji: 1 }, randomD6);
  const afterA = clone({ ...s, history: undefined, redo: undefined });
  const undone = undo(s);
  assert.equal(undone.sec, 0);
  assert.equal(undone.redo.length, 1);
  const back = replay(undone);
  assert.deepEqual(clone({ ...back, history: undefined, redo: undefined }), afterA);
  assert.equal(back.redo.length, 0);
  assert.equal(back.history.length, 1, "it can be undone again");
});

test("replay can be repeated after several undos, newest first", async () => {
  let s = freshState();
  for (let i = 0; i < 3; i++) await roll(s, {}, randomD6);
  const afterThree = clone({ ...s, history: undefined, redo: undefined });
  s = undo(s); s = undo(s); s = undo(s);
  assert.equal(s.sec, 0); assert.equal(s.redo.length, 3);
  s = replay(s); s = replay(s); s = replay(s);
  assert.deepEqual(clone({ ...s, history: undefined, redo: undefined }), afterThree);
  assert.equal(replay(s), null, "nothing left to replay");
});

test("rolling a new section clears the replay stack", async () => {
  let s = freshState();
  await roll(s, {}, randomD6);
  s = undo(s);
  assert.equal(s.redo.length, 1);
  await roll(s, {}, randomD6);
  assert.equal(s.redo.length, 0);
  assert.equal(replay(s), null);
});

test("redo with the same dice gives the same NPC results, even after a PC modifier changes", async () => {
  let s = freshState();
  await roll(s, { violet: 1, aji: 1 }, randomD6);       // section A: the lap rolls
  const first = vpOf(s);
  s = undo(s);
  const dice = undoneDice(s);
  assert.ok(dice.d6.length >= 6, "the six NPC lap rolls were recorded");
  const never = async () => { throw new Error("should not roll fresh dice"); };
  await roll(s, { violet: 4, aji: 1 }, never, dice);    // the GM fixed Violet's modifier
  const second = vpOf(s);
  for (const r of ROSTER.filter((x) => !x.pc)) assert.equal(second[r.id], first[r.id], `${r.id} same`);
  assert.equal(second.violet, 4);
  assert.equal(s.redo.length, 0);
});

test("redo uses fresh dice for any draw the recording doesn't cover, and keeps going", async () => {
  let s = freshState();
  await roll(s, {}, fakeD6([3]));
  s = undo(s);
  const dice = { d6: [6], rand: [] };                   // only one recorded draw
  const fresh = fakeD6([2]);
  await roll(s, {}, fresh, dice, { rand: () => 0.99 });
  assert.equal(s.lastDice.d6.length >= 6, true);
  assert.equal(s.lastDice.d6[0], 6, "the recorded one came first");
  assert.equal(s.lastDice.d6[1], 2, "then fresh rolls");
});

test("a recorder with no replay records every draw in order", async () => {
  const rec = makeRecorder(fakeD6([4, 5]), null, () => 0.25);
  assert.equal(await rec.d6(), 4); assert.equal(await rec.d6(), 5);
  assert.equal(rec.rand(), 0.25);
  assert.deepEqual(rec.rec, { d6: [4, 5], rand: [0.25] });
});

test("the battle section's random choices replay the same too", async () => {
  let s = freshState();
  for (let i = 0; i < 2; i++) await roll(s, {}, randomD6);   // A, B
  const beforeC = clone({ ...s, history: undefined, redo: undefined });
  await roll(s, {}, randomD6);                               // C: attacks and shuffles
  const resultC = vpOf(s);
  s = undo(s);
  assert.deepEqual(clone({ ...s, history: undefined, redo: undefined, lastDice: undefined }), clone({ ...beforeC, lastDice: undefined }));
  const never = async () => { throw new Error("fresh d6"); };
  await roll(s, {}, never, undoneDice(s));
  assert.deepEqual(vpOf(s), resultC);
});

test("undo keeps working when there is no redo field (state saved by an older version)", async () => {
  let s = freshState();
  await roll(s, {}, randomD6);
  delete s.redo;
  const u = undo(s);
  assert.ok(u && u.redo.length === 1);
});

test("setVp changes one total, rounds, and refuses bad input", () => {
  const s = freshState();
  const ok = setVp(s, "aji", "7");
  assert.deepEqual([ok.ok, ok.from, ok.to], [true, 0, 7]);
  assert.equal(s.vp.aji, 7);
  assert.equal(setVp(s, "aji", 3.6).to, 4);
  assert.equal(setVp(s, "aji", -2).to, -2);
  for (const bad of ["", null, undefined, "abc", NaN, Infinity, 5000, -500]) assert.equal(setVp(s, "aji", bad).ok, false, String(bad));
  assert.equal(setVp(s, "nobody", 3).ok, false);
  assert.equal(s.vp.aji, -2, "failed edits change nothing");
});

test("the tower offers Replay only to the GM, and only after an undo; totals are editable for the GM only", async () => {
  let s = freshState();
  await roll(s, {}, randomD6);
  assert.equal(towerContext(s, { isGM: true }).canReplay, false);
  s = undo(s);
  assert.equal(towerContext(s, { isGM: true }).canReplay, true);
  assert.equal(towerContext(s, { isGM: false }).canReplay, false);
  assert.ok(towerContext(s, { isGM: true }).rows.every((r) => r.editable));
  assert.ok(towerContext(s, { isGM: false }).rows.every((r) => !r.editable));
});

test("roll modes: public has no whisper, private adds the roller, blind hides it from the roller, self is only the roller", () => {
  const gms = ["gm1", "gm2"];
  assert.deepEqual(visibility("publicroll", "p1", gms), {});
  assert.deepEqual(visibility("gmroll", "p1", gms).whisper.sort(), ["gm1", "gm2", "p1"]);
  assert.deepEqual(visibility("gmroll", "gm1", gms).whisper.sort(), ["gm1", "gm2"]);
  assert.deepEqual(visibility("blindroll", "p1", gms), { whisper: ["gm1", "gm2"], blind: true });
  assert.deepEqual(visibility("selfroll", "p1", gms), { whisper: ["p1"] });
});

test("an unknown or missing roll mode falls back to public for a player and a private GM roll for a GM", () => {
  for (const m of ROLL_MODES) assert.equal(normalizeMode(m), m);
  assert.equal(normalizeMode(undefined, false), "publicroll");
  assert.equal(normalizeMode("bogus", false), "publicroll");
  assert.equal(normalizeMode(undefined, true), "gmroll");
});
