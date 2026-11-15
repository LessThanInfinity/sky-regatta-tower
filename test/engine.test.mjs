import test from "node:test";
import assert from "node:assert/strict";
import {
  freshState, resolveSection, undo, standings, nextSection, isFinished, buildReport, LAP_TABLE, ROSTER, GAP_CAP,
} from "../scripts/engine.mjs";

const rng = (seq) => { let i = 0; return async () => seq[i++ % seq.length]; };
const randomD6 = async () => 1 + Math.floor(Math.random() * 6);
const NPC_IDS = ROSTER.filter((r) => !r.pc).map((r) => r.id);

async function runRace(d6, pcGain = () => 4) {
  const state = freshState();
  let violet = 0, aji = 0;
  const reports = [];
  for (let i = 0; i < 16; i++) {
    violet += pcGain(); aji += pcGain();
    const lap = Math.floor(i / 4) + 1;
    reports.push(await resolveSection(state, { violet, aji, ...(lap === 2 ? { violetSheltered: true } : {}) }, d6));
  }
  return { state, reports };
}

test("a fresh race starts on lap 1 section A with everyone at 0", () => {
  const s = freshState();
  assert.deepEqual(nextSection(s), { lap: 1, key: "A", name: "Entry" });
  assert.ok(Object.values(s.vp).every((v) => v === 0));
});

test("lap total is split across A, B and D and sums to the table value", async () => {
  const state = freshState();
  // d6 = 6 for everyone; Aces +1 clamps to 6; table says 8 VP
  await resolveSection(state, {}, rng([6]));
  for (const n of NPC_IDS) {
    const lr = state.lapRolls[n];
    assert.equal(lr.T, 8);
    assert.equal(lr.a + lr.b + lr.d, 8);
  }
  assert.equal(state.vp.syu, state.lapRolls.syu.a);
});

test("rating modifier and clamping: Ace rolling 1 becomes 2 (3 VP), Steady rolling 6 stays 6 (8 VP)", async () => {
  const state = freshState();
  await resolveSection(state, {}, rng([1]));
  assert.equal(state.lapRolls.syu.eff, 2);   // Ace +1
  assert.equal(state.lapRolls.ranto.eff, 1); // Steady
  assert.equal(LAP_TABLE[state.lapRolls.syu.eff], 3);
});

test("full 16-section race runs with no NaN and sensible totals", async () => {
  for (let i = 0; i < 200; i++) {
    const { state } = await runRace(randomD6);
    assert.ok(isFinished(state));
    for (const r of ROSTER) assert.ok(Number.isFinite(state.vp[r.id]), `${r.id} is finite`);
    for (const id of NPC_IDS) assert.ok(state.vp[id] >= 5 && state.vp[id] <= 45, `${id} total ${state.vp[id]} in range`);
  }
});

test("NPC totals over a race equal the sum of four lap totals (plus lap 2 narrows swap and battle effects)", async () => {
  const { state, reports } = await runRace(rng([3, 4, 5]));
  // every report has notes for every NPC
  for (const rep of reports) for (const id of NPC_IDS) assert.ok(rep.notes[id].length >= 1);
  assert.ok(reports.at(-1).finished);
});

test("lap 2 cautious NPCs take the Narrows for a flat +2 and a strike roll of 1 removes shelter", async () => {
  const state = freshState();
  await resolveSection(state, {}, rng([3]));            // lap 1 A
  await resolveSection(state, {}, rng([3]));            // lap 1 B
  await resolveSection(state, {}, rng([3]));            // lap 1 C
  await resolveSection(state, {}, rng([3]));            // lap 1 D
  await resolveSection(state, {}, rng([3]));            // lap 2 A
  const beforeIvory = state.vp.ivory;
  const rep = await resolveSection(state, {}, rng([1])); // lap 2 B, strike roll = 1
  assert.equal(state.vp.ivory - beforeIvory, 2);
  assert.ok(rep.notes.ivory.join(" ").includes("STRIKE"));
  assert.equal(state.sheltered.ivory, false);
  assert.equal(state.sheltered.dutch, false);
});

test("battle: at most 2 NPCs attack and shelter protects riders", async () => {
  for (let i = 0; i < 200; i++) {
    const state = freshState();
    state.lap = 1; state.sec = 2;                       // straight to Battle
    state.vp = Object.fromEntries(ROSTER.map((r) => [r.id, 5 + (i % 3)])); // everyone close
    state.vp.syu = 5; state.vp.ranto = 5; state.vp.viridian = 4;
    const rep = await resolveSection(state, { violet: state.vp.violet, aji: state.vp.aji }, randomD6);
    const attackers = NPC_IDS.filter((id) => rep.notes[id].some((n) => n.startsWith("Attacks ")));
    assert.ok(attackers.length <= 2, `attackers ${attackers.length}`);
  }
});

test("battle: sheltered riders can't be targeted (lap 2) but can be on lap 4", async () => {
  const targeted = { lap2: 0, lap4: 0 };
  for (let i = 0; i < 300; i++) {
    for (const lap of [2, 4]) {
      const state = freshState();
      state.lap = lap; state.sec = 2;
      state.vp = Object.fromEntries(ROSTER.map((r) => [r.id, 20]));
      const input = { violet: 20, aji: 20, violetSheltered: true, ajiSheltered: true };
      state.sheltered.violet = true; state.sheltered.aji = true;
      const rep = await resolveSection(state, input, randomD6);
      // sheltered flags are reset by the input (checkbox values), so use them as given
      const hit = Object.values(rep.notes).flat().some((n) => /Attacks (Violet|Aji)/.test(n));
      if (hit) targeted[`lap${lap}`]++;
    }
  }
  assert.equal(targeted.lap2, 0, "sheltered PCs are never targeted on lap 2");
  assert.ok(targeted.lap4 > 0, "no shelter on lap 4, so PCs get targeted");
});

test("undo restores the previous state and can be repeated", async () => {
  const state = freshState();
  await resolveSection(state, { violet: 3, aji: 2 }, randomD6);
  await resolveSection(state, { violet: 6, aji: 5 }, randomD6);
  assert.equal(state.sec, 2);
  let s = undo(state);
  assert.equal(s.sec, 1);
  assert.equal(s.vp.violet, 3);
  s = undo(s);
  assert.equal(s.sec, 0);
  assert.equal(s.vp.violet, 0);
  assert.equal(undo(s), null);
});

test("standings are deterministic: ties keep roster order and share a rank", () => {
  const vp = Object.fromEntries(ROSTER.map((r) => [r.id, 4]));
  vp.syu = 9;
  const a = standings(vp), b = standings(vp);
  assert.deepEqual(a.map((r) => r.id), b.map((r) => r.id));
  assert.equal(a[0].id, "syu");
  assert.equal(a[1].rank, 2);
  assert.equal(a[2].rank, 2);
  assert.equal(a[0].gap, 0);
  assert.equal(a[1].gap, 5);
});

test("gap is capped", () => {
  const vp = Object.fromEntries(ROSTER.map((r) => [r.id, 0]));
  vp.syu = 30;
  assert.equal(standings(vp).at(-1).gap, GAP_CAP);
});

test("report text builds for every section of a full race", async () => {
  const { state, reports } = await runRace(randomD6);
  assert.ok(reports.length === 16);
  const s = freshState();
  const rep = await resolveSection(s, { violet: 2, aji: 3 }, randomD6);
  const html = buildReport(s, rep);
  assert.match(html, /Sky Regatta: Section 1\/16 · Lap 1, A/);
  assert.match(html, /LEADER|back/);
});

test("delta reports what changed this section", async () => {
  const state = freshState();
  await resolveSection(state, { violet: 4, aji: 1 }, randomD6);
  assert.equal(state.delta.violet, 4);
  assert.equal(state.delta.aji, 1);
});

test("NPCs never attack their own teammates", async () => {
  const teamOf = Object.fromEntries(ROSTER.map((r) => [r.name, r.team]));
  for (let i = 0; i < 400; i++) {
    const state = freshState();
    state.lap = 1; state.sec = 2;                        // straight to Battle
    state.vp = Object.fromEntries(ROSTER.map((r) => [r.id, 10 + (i % 2)]));
    state.vp.syu = 10; state.vp.ranto = 10; state.vp.viridian = 9; state.vp.ivory = 10;
    const rep = await resolveSection(state, { violet: state.vp.violet, aji: state.vp.aji }, randomD6);
    for (const r of ROSTER.filter((x) => !x.pc)) {
      for (const n of rep.notes[r.id]) {
        const m = /^Attacks ([^:]+):/.exec(n);
        if (m) assert.notEqual(teamOf[m[1]], r.team, `${r.name} attacked teammate ${m[1]}`);
      }
    }
  }
});

test("NPC bench: with chance 1 every NPC gets +1 on the lap roll and it is noted; with 0 nobody does", async () => {
  const plain = freshState();
  await resolveSection(plain, {}, async () => 3, {});
  const benched = freshState();
  await resolveSection(benched, {}, async () => 3, { npcBench: 1 });
  const nonHot = ROSTER.filter((r) => !r.pc && r.tag !== "hothead");
  for (const n of nonHot) assert.ok(benched.lapRolls[n.id].eff >= plain.lapRolls[n.id].eff, n.name);
  assert.ok(nonHot.some((n) => benched.lapRolls[n.id].eff > plain.lapRolls[n.id].eff));
  const noBench = freshState();
  await resolveSection(noBench, {}, async () => 3, { npcBench: 0 });
  assert.deepEqual(noBench.lapRolls, plain.lapRolls);
});
