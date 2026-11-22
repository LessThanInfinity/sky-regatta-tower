import test from "node:test";
import assert from "node:assert/strict";
import { planRace, VIEW } from "../scripts/racelayout.mjs";
import { ROSTER } from "../scripts/engine.mjs";
import { seeded, wyvernSvg, DEFS_SVG, groundTileSvg } from "../scripts/wyvern.mjs";
import { DRAKE_LOOK } from "../scripts/viz.mjs";

const IDS = ["violet", "aji", "viridian", "ivory", "syu", "ranto", "sarah", "dutch"];
const vp = (arr) => Object.fromEntries(IDS.map((id, i) => [id, arr[i]]));
const byRank = (plan) => IDS.map((id) => ({ id, ...plan.riders[id] })).sort((a, b) => a.rank - b.rank);
const avail = VIEW.H - VIEW.TOP - VIEW.BOTTOM;

test("the leader is on top and the order follows VP", () => {
  const plan = planRace(vp([5, 3, 6, 4, 5, 2, 4, 1]), IDS);
  assert.deepEqual(byRank(plan).map((r) => r.id), ["viridian", "violet", "syu", "ivory", "sarah", "aji", "ranto", "dutch"]);
  assert.equal(plan.riders.viridian.ty, VIEW.TOP);
});

test("positions only go down the stage as rank worsens, and never closer than MIN_STEP", () => {
  for (const arr of [[5, 3, 6, 4, 5, 2, 4, 1], [5, 5, 5, 5, 5, 5, 5, 5], [30, 24, 17, 12, 8, 5, 2, 0], [10, 9, 9, 9, 9, 9, 9, 9]]) {
    const o = byRank(planRace(vp(arr), IDS));
    for (let i = 1; i < o.length; i++) assert.ok(o[i].ty - o[i - 1].ty >= VIEW.MIN_STEP - 1e-9, `${arr}: ${o[i].id}`);
    assert.ok(o.at(-1).ty <= VIEW.H - VIEW.BOTTOM + 1e-9, "stays inside the stage");
  }
});

test("a tied field is spread evenly over the whole stage", () => {
  const o = byRank(planRace(vp(Array(8).fill(5)), IDS));
  assert.equal(o[0].ty, VIEW.TOP);
  assert.ok(Math.abs(o.at(-1).ty - (VIEW.TOP + avail)) < 1e-6);
  const step = o[1].ty - o[0].ty;
  for (let i = 1; i < o.length; i++) assert.ok(Math.abs(o[i].ty - o[i - 1].ty - step) < 1e-6);
});

test("steady thirds: the top three sit in the top third, the last three in the bottom third", () => {
  for (const arr of [[6, 5, 5, 4, 4, 3, 2, 1], [14, 14, 11, 10, 9, 9, 8, 6], [30, 24, 17, 12, 8, 5, 2, 0]]) {
    const o = byRank(planRace(vp(arr), IDS));
    const third = avail / 3;
    for (const r of o.slice(0, 3)) assert.ok(r.ty - VIEW.TOP <= avail * 0.4, `${arr} top ${r.id}`);
    for (const r of o.slice(3, 5)) assert.ok(r.ty - VIEW.TOP > third * 0.8 && r.ty - VIEW.TOP < avail * 0.8, `${arr} middle ${r.id}`);
    for (const r of o.slice(5)) assert.ok(r.ty - VIEW.TOP >= avail * 0.6, `${arr} bottom ${r.id}`);
  }
});

test("a bigger VP gap looks bigger", () => {
  const near = planRace(vp([10, 9, 8, 7, 6, 5, 4, 3]), IDS);
  const far = planRace(vp([30, 9, 8, 7, 6, 5, 4, 3]), IDS);
  const gapNear = near.riders.aji.ty - near.riders.violet.ty;
  const gapFar = far.riders.aji.ty - far.riders.violet.ty;
  assert.ok(gapFar > gapNear);
});

test("drakes close together vertically are kept well apart sideways (as far as the stage allows)", () => {
  for (const arr of [[6, 5, 5, 4, 4, 3, 2, 1], [5, 5, 5, 5, 5, 5, 5, 5], [10, 9, 9, 9, 9, 9, 9, 9]]) {
    const o = byRank(planRace(vp(arr), IDS));
    for (let i = 0; i < o.length; i++) for (let j = i + 1; j < o.length; j++) {
      if (Math.abs(o[i].ty - o[j].ty) < VIEW.SEP_Y) assert.ok(Math.abs(o[i].bx - o[j].bx) >= 90, `${arr}: ${o[i].id}/${o[j].id}`);
    }
  }
});

test("every drake stays inside the side margins", () => {
  const o = byRank(planRace(vp([5, 5, 5, 5, 5, 5, 5, 5]), IDS));
  for (const r of o) assert.ok(r.bx >= VIEW.SLOT_MARGIN && r.bx <= VIEW.W - VIEW.SLOT_MARGIN);
});

test("the same standings always give the same plan, and lanes are kept when nothing moves", () => {
  const a = planRace(vp([6, 5, 5, 4, 4, 3, 2, 1]), IDS);
  assert.deepEqual(planRace(vp([6, 5, 5, 4, 4, 3, 2, 1]), IDS), a);
  assert.deepEqual(planRace(vp([6, 5, 5, 4, 4, 3, 2, 1]), IDS, a.riders), a);
});

test("an exact tie keeps the order the riders already had", () => {
  const first = planRace(vp([6, 3, 5, 4, 4, 3, 2, 1]), IDS);               // aji 3, ranto 3 ...
  const next = planRace(vp([6, 5, 5, 4, 4, 3, 2, 1]), IDS, first.riders);  // viridian ahead of aji before, now tied with aji
  assert.ok(next.riders.viridian.rank < next.riders.aji.rank);
});

test("the camera shrinks the drakes only for a very wide field", () => {
  assert.equal(planRace(vp([6, 5, 5, 4, 4, 3, 2, 1]), IDS).cam, 1);
  assert.ok(planRace(vp([30, 24, 17, 12, 8, 5, 2, 0]), IDS).cam < 0.8);
  assert.ok(planRace(vp([300, 0, 0, 0, 0, 0, 0, 0]), IDS).cam >= 0.7);
});

test("missing riders and a short roster don't break it", () => {
  const plan = planRace({ a: 3 }, ["a", "b"]);
  assert.equal(plan.riders.a.rank, 0);
  assert.equal(planRace({}, []).cam, 1);
});

test("every race rider has a drake look, a team color and unique token letters", () => {
  const marks = new Set();
  for (const r of ROSTER) {
    assert.ok(DRAKE_LOOK[r.id], `look for ${r.id}`);
    assert.match(r.color, /^#[0-9a-f]{6}$/i);
    marks.add(DRAKE_LOOK[r.id].mark);
  }
  assert.equal(marks.size, ROSTER.length);
  assert.deepEqual(ROSTER.map((r) => r.id), IDS);
});

test("artwork helpers give well-formed SVG and repeatable terrain", () => {
  const w = wyvernSvg();
  assert.match(w, /^<svg[\s\S]*<\/svg>$/);
  for (const cls of ['class="wl"', 'class="wr"', 'class="tail"']) assert.ok(w.includes(cls), cls);
  assert.equal((w.match(/class="wing"/g) ?? []).length, 2);
  assert.ok(DEFS_SVG.includes("srt-scales") && w.includes("url(#srt-scales)"));
  assert.equal(seeded(5)(), seeded(5)());
  assert.equal(groundTileSvg(340, 1400, seeded(1)), groundTileSvg(340, 1400, seeded(1)));
});
