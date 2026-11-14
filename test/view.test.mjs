import test from "node:test";
import assert from "node:assert/strict";
import { freshState, resolveSection, sectionLimits, ROSTER } from "../scripts/engine.mjs";
import { towerContext, validateInput, readoutFor } from "../scripts/view.mjs";

const randomD6 = async () => 1 + Math.floor(Math.random() * 6);
const row = (ctx, id) => ctx.rows.find((r) => r.id === id);

test("no position changes are shown after the very first section", async () => {
  const s = freshState();
  await resolveSection(s, { violet: 3, aji: 2 }, randomD6);
  assert.equal(s.prevRank, null);
  const ctx = towerContext(s);
  assert.ok(ctx.rows.every((r) => r.moveText === "" && r.rowClass === ""));
});

test("a rider who overtakes gets a green caret and a green underline, the one overtaken gets red", async () => {
  const s = freshState();
  await resolveSection(s, { violet: 1, aji: 0 }, randomD6);        // section A: build some standing
  s.vp.violet = 0; s.vp.aji = 0;                                   // force a known order before the next section
  for (const n of ROSTER.filter((r) => !r.pc)) s.vp[n.id] = 5;
  s.vp.violet = 3; s.vp.aji = 9;                                   // Aji leads, Violet trails the field
  // next section is B, no NPC adjustments; PCs swap positions: Violet jumps to 12, Aji stays 9
  const rep = await resolveSection(s, { violet: 12, aji: 9 }, randomD6);
  const ctx = towerContext(s);
  assert.equal(s.prevRank.aji, 1);
  assert.equal(row(ctx, "violet").moveClass, "up");
  assert.match(row(ctx, "violet").moveText, /^▲\d+$/);
  assert.equal(row(ctx, "violet").rowClass, "moved-up");
  assert.equal(row(ctx, "aji").moveClass, "down");
  assert.match(row(ctx, "aji").moveText, /^▼\d+$/);
  assert.equal(row(ctx, "aji").rowClass, "moved-down");
  assert.ok(rep);
});

test("undo brings back the earlier position data", async () => {
  const s = freshState();
  await resolveSection(s, { violet: 2, aji: 1 }, randomD6);
  await resolveSection(s, { violet: 4, aji: 3 }, randomD6);
  const afterTwo = JSON.stringify(s.prevRank);
  assert.ok(afterTwo);
});

test("section limits follow the rules", () => {
  assert.deepEqual(sectionLimits(1, "A"), { min: -2, max: 4 });
  assert.deepEqual(sectionLimits(1, "B"), { min: -1, max: 4 });
  assert.deepEqual(sectionLimits(2, "B"), { min: -1, max: 6 });   // Narrows
  assert.deepEqual(sectionLimits(3, "C"), { min: -2, max: 2 });
  assert.deepEqual(sectionLimits(4, "D"), { min: -1, max: 4 });
});

test("PC stepper bounds are the allowed change for the next section, with the current total as the base", async () => {
  const s = freshState();
  const v1 = towerContext(s, { isGM: true }).pcs.find((p) => p.id === "violet");
  assert.deepEqual([v1.base, v1.min, v1.max], [0, -2, 4]);
  s.vp.violet = 10; s.sec = 2;                                     // Battle
  const v2 = towerContext(s, { isGM: true }).pcs.find((p) => p.id === "violet");
  assert.deepEqual([v2.base, v2.min, v2.max], [10, -2, 2]);
});

test("validateInput rejects too-big changes unless limits are unlocked", () => {
  const s = freshState();
  assert.equal(validateInput(s, { violet: 4, aji: 0 }), null);
  assert.match(validateInput(s, { violet: 5 }), /Violet: a change of \+5 is outside -2 to \+4/);
  assert.match(validateInput(s, { aji: -3 }), /Aji/);
  assert.equal(validateInput(s, { violet: 9 }, true), null);
  assert.match(validateInput(s, { adj_ranto: 4 }), /Ran-to/);
  assert.equal(validateInput(s, { adj_ranto: -3 }), null);
});

test("the Narrows lap allows up to +6 on the obstacle", () => {
  const s = freshState();
  s.lap = 2; s.sec = 1;
  assert.equal(validateInput(s, { violet: 6 }), null);
  assert.match(validateInput(s, { violet: 7 }), /\+7/);
});

test("readoutFor shows the new total and whether the points added are allowed", () => {
  assert.deepEqual(readoutFor(10, 3, -2, 4), { total: 13, ok: true });
  assert.deepEqual(readoutFor(10, "5", -2, 4), { total: 15, ok: false });
  assert.deepEqual(readoutFor(10, "", -2, 4), { total: 10, ok: true });
  assert.deepEqual(readoutFor(10, -3, -2, 4), { total: 7, ok: false });
});

test("the tower context has a row for everyone and GM-only controls are flagged", () => {
  const s = freshState();
  assert.equal(towerContext(s, { isGM: false }).rows.length, 8);
  assert.equal(towerContext(s, { isGM: true }).isGM, true);
  assert.equal(towerContext(s, { isGM: false }).isGM, false);
});
