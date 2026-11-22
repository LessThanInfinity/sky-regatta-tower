import test from "node:test";
import assert from "node:assert/strict";
import { freshState, resolveSection, sectionLimits } from "../scripts/engine.mjs";
import { applyPcCheck, applyNarrows, computeMod, validatePcRequest, RULES } from "../scripts/rolls.mjs";
import { availableBenchActions, validateBenchRequest, applyBenchAction, clearBenchAct, buildBenchDialogHtml, buildBenchCardHtml, readBenchForm, benchMod, PIT_COST } from "../scripts/bench.mjs";

const roll = (nat, mod = 20) => ({ nat, mod, parts: [{ label: "skill", value: mod }] });
const act = (s, over, r = roll(15)) => applyBenchAction(s, { benchId: "reta", action: "spotter", rider: "violet", ...over }, r);
const d6 = async () => 3;
const circ = (s, pc, key = "A") => computeMod(s, pc, key, {}, 18).parts.find((p) => p.label === "circumstance")?.value;

test("a Spotter success is +1 and a crit +2 circumstance, and the best circumstance bonus wins over Surging", () => {
  const s = freshState();
  assert.ok(act(s, {}, roll(10, 20)).ok);                       // 30 vs DC 28: success
  assert.equal(s.bench.help.violet.bonus, 1);
  assert.equal(circ(s, "violet"), 1);
  const s2 = freshState();
  act(s2, {}, roll(18, 20));                                    // 38: crit
  assert.equal(s2.bench.help.violet.bonus, 2);
  s2.drake.violet = -1;                                         // Surging is +1, the Spotter's +2 is better and they don't stack
  assert.equal(circ(s2, "violet"), 2);
  const s3 = freshState(); s3.drake.violet = -1;
  assert.equal(circ(s3, "violet"), 1);
});

test("one bench action per member per section; help must come before the rider rolls", () => {
  const s = freshState();
  assert.ok(act(s, {}).ok);
  assert.equal(validateBenchRequest(s, { benchId: "reta", action: "fix", rider: "violet", skill: "nature" }).ok, false, "Reta already acted");
  assert.equal(validateBenchRequest(s, { benchId: "rowan", action: "spotter", rider: "aji" }).ok, true, "Rowan still can");
  applyPcCheck(s, { pcId: "aji", choiceId: "muscle-through:athletics", lineId: "standard" }, roll(15, 20));
  assert.equal(validateBenchRequest(s, { benchId: "rowan", action: "spotter", rider: "aji" }).ok, false, "Aji already rolled");
  assert.equal(validateBenchRequest(s, { benchId: "rowan", action: "pit", rider: "aji", skill: "nature" }).ok, true, "a pit stop can still happen");
  assert.equal(validateBenchRequest(s, { benchId: "rowan", action: "pit", rider: "aji", skill: "survival" }).ok, false, "pit crew uses Nature, Medicine or Crafting");
});

test("pit crew: -1 VP, the drake climbs, once per rider per lap, and it undoes cleanly", () => {
  const s = freshState();
  s.drake.violet = 1;                                           // Winded
  const r = applyBenchAction(s, { benchId: "rowan", action: "pit", rider: "violet", skill: "nature" }, roll(12, 20));   // 32 vs 30
  assert.ok(r.ok);
  assert.equal(s.drake.violet, 0);
  assert.equal(s.bench.pit.violet.cost, PIT_COST);
  assert.equal(validateBenchRequest(s, { benchId: "reta", action: "pit", rider: "violet", skill: "crafting" }).ok, false, "only one stop per lap");
  clearBenchAct(s, "rowan");
  assert.equal(s.drake.violet, 1);
  assert.equal(s.bench.pit.violet, undefined);
  assert.equal(s.bench.pitLap.violet, undefined);
  assert.equal(s.bench.acts.rowan, undefined);
});

test("a pit crit takes the drake up two rungs but never above Surging; a crit failure drops it", () => {
  const s = freshState(); s.drake.violet = 1;
  applyBenchAction(s, { benchId: "rowan", action: "pit", rider: "violet", skill: "nature" }, roll(20, 20));     // crit
  assert.equal(s.drake.violet, -1);
  const s2 = freshState(); s2.drake.aji = -1;
  applyBenchAction(s2, { benchId: "rowan", action: "pit", rider: "aji", skill: "crafting" }, roll(20, 20));
  assert.equal(s2.drake.aji, -1, "already Surging");
  const s3 = freshState(); s3.drake.violet = 0;
  applyBenchAction(s3, { benchId: "rowan", action: "pit", rider: "violet", skill: "nature" }, roll(1, 0));        // crit failure
  assert.equal(s3.drake.violet, 1);
});

test("the pit cost comes off the rider's VP when the section resolves, and the bench is cleared after", async () => {
  const s = freshState();
  s.drake.violet = 2;
  applyBenchAction(s, { benchId: "rowan", action: "pit", rider: "violet", skill: "nature" }, roll(12, 20));
  applyPcCheck(s, { pcId: "violet", choiceId: "muscle-through:athletics", lineId: "standard" }, roll(15, 20), { autoVp: true });   // success: +2
  await resolveSection(s, {}, d6);
  assert.equal(s.vp.violet, 2 + PIT_COST);
  assert.deepEqual(s.bench.acts, {});
  assert.deepEqual(s.bench.help, {});
  assert.deepEqual(s.bench.pit, {});
  assert.equal(s.bench.pitLap.violet, 1, "the lap of the last stop is remembered");
  assert.equal(sectionLimits(1, "B", { pit: true }).min, sectionLimits(1, "B").min - 1);
});

test("Fix it: the penalty is ignored and a Narrows strike is cancelled", () => {
  const s = freshState(); s.lap = 2; s.sec = 1; s.drake.violet = 2;
  const hasDrake = () => computeMod(s, "violet", "A", {}, 18).parts.some((p) => /drake/.test(p.label));
  assert.equal(hasDrake(), true);
  applyBenchAction(s, { benchId: "rowan", action: "fix", rider: "violet", skill: "nature" }, roll(12, 20));
  assert.equal(hasDrake(), false);
  const nreq = { pcId: "violet", choiceId: "the-narrows-inside-sheltered:narrows", narrows: ["athletics", "nature", "survival"] };
  const res = applyNarrows(s, nreq, [{ skill: "athletics", nat: 2, mod: 20 }, { skill: "nature", nat: 15, mod: 20 }, { skill: "survival", nat: 3, mod: 20 }], { autoVp: true });
  assert.ok(res.ok);
  assert.equal(s.sheltered.violet, true, "two failures, one cancelled: still sheltered");
  assert.ok(s.pending.violet.notes.some((n) => /cancelled/.test(n)));
});

test("Fix it on a crit gives the last used skill back and undoes cleanly; Scout needs the extras setting", () => {
  const s = freshState();
  assert.equal(validateBenchRequest(s, { benchId: "reta", action: "scout", rider: "violet" }).ok, false, "Scout is off by default");
  applyPcCheck(s, { pcId: "violet", choiceId: "muscle-through:athletics", lineId: "standard" }, roll(15, 20));
  assert.deepEqual(s.used.violet, ["athletics"]);
  delete s.pending.violet;                                   // the next section: Violet has not rolled yet
  applyBenchAction(s, { benchId: "rowan", action: "fix", rider: "violet", skill: "nature" }, roll(20, 20));   // nat 20: a success becomes a crit
  assert.deepEqual(s.used.violet, []);
  clearBenchAct(s, "rowan");
  assert.deepEqual(s.used.violet, ["athletics"]);
  RULES.benchExtras = true;
  assert.equal(validateBenchRequest(s, { benchId: "reta", action: "scout", rider: "violet" }).ok, true);
  RULES.benchExtras = false;
  assert.deepEqual(availableBenchActions("A").map((a) => a.id), ["spotter", "pit", "fix"]);
});

test("Battle: the bench can Call the attack or Work the crowd (and pit), not Spotter or Fix it", () => {
  assert.deepEqual(availableBenchActions("C").map((a) => a.id), ["pit", "call", "crowd"]);
  const s = freshState(); s.sec = 2;
  assert.equal(validateBenchRequest(s, { benchId: "reta", action: "spotter", rider: "violet" }).ok, false);
  const c = applyBenchAction(s, { benchId: "reta", action: "crowd" }, roll(10, 23));   // 33 vs 28
  assert.ok(c.ok); assert.equal(s.favor.party, 1);
  const k = applyBenchAction(s, { benchId: "rowan", action: "call", rider: "violet" }, roll(20, 22));   // crit
  assert.ok(k.ok); assert.equal(s.bench.help.violet.cancelAttack, true); assert.equal(s.favor.party, 2);
  clearBenchAct(s, "rowan"); clearBenchAct(s, "reta");
  assert.equal(s.favor.party, 0); assert.equal(s.bench.help.violet, undefined);
});

test("a bench call cancels one NPC attack on the rider, once, and is spent after the section", async () => {
  for (const withCall of [false, true]) {
    const s = freshState(); s.sec = 2;
    for (const id of Object.keys(s.vp)) s.vp[id] = 10;       // everyone in range
    for (const t of ["syu", "ranto", "viridian", "ivory", "sarah", "dutch"]) if (s.sheltered) s.sheltered[t] = false;
    if (withCall) applyBenchAction(s, { benchId: "reta", action: "call", rider: "violet" }, roll(15, 20));
    const rep = await resolveSection(s, {}, async () => 6);   // every d6 hits
    const hitsOnViolet = Object.values(rep.notes).flat().filter((n) => /^Attacks Violet/.test(n));
    if (hitsOnViolet.length) {
      const cancelled = hitsOnViolet.filter((n) => /bench called it/.test(n)).length;
      assert.equal(cancelled, withCall ? 1 : 0);
    }
    assert.deepEqual(s.bench.help, {});
  }
});

test("Burn: off by default; when on, +2 on the roll, the drake drops a rung, only for a Fresh or Surging drake, never in the Narrows", () => {
  const off = freshState();
  assert.equal(validatePcRequest(off, { pcId: "violet", choiceId: "muscle-through:athletics", lineId: "standard", burn: true }).ok, false);
  RULES.burn = true;
  const s = freshState();
  const req = { pcId: "violet", choiceId: "muscle-through:athletics", lineId: "standard", burn: true };
  const m = computeMod(s, "violet", "A", req, 18);
  assert.equal(m.parts.find((p) => p.label === "Burn").value, 2);
  assert.ok(applyPcCheck(s, req, { nat: 12, mod: m.total, parts: m.parts }).ok);
  assert.equal(s.drake.violet, 1);
  const w = freshState(); w.drake.aji = 1;
  assert.equal(validatePcRequest(w, { ...req, pcId: "aji" }).ok, false);
  const n = freshState(); n.lap = 2; n.sec = 1;
  assert.equal(validatePcRequest(n, { pcId: "violet", choiceId: "the-narrows-inside-sheltered:narrows", narrows: ["athletics", "nature", "survival"], burn: true }).ok, false);
  RULES.burn = false;
});

test("Surging lasts until the lap ends, then becomes Fresh", async () => {
  const s = freshState(); s.drake.violet = -1; s.drake.aji = 1;
  for (let i = 0; i < 3; i++) await resolveSection(s, {}, d6);
  assert.equal(s.drake.violet, -1, "still Surging mid-lap");
  await resolveSection(s, {}, d6);                            // the lap's last section
  assert.equal(s.lap, 2);
  assert.equal(s.drake.violet, 0);
  assert.equal(s.drake.aji, 1, "other conditions are not refreshed");
});

test("the bench dialog lists the standard actions for the section, both riders, skill choices, and a locked view after acting", () => {
  const s = freshState();
  const html = buildBenchDialogHtml(s, "rowan", { mods: { perception: 22, nature: 20, crafting: 22 } });
  assert.equal((html.match(/<input type="radio" name="action"/g) ?? []).length, 3);
  assert.equal((html.match(/<input type="radio" name="rider"/g) ?? []).length, 2);
  assert.match(html, /name="skill_pit"/);
  assert.doesNotMatch(html, /<form/i);
  assert.ok(html.includes(`Perception +${benchMod(22)}`));
  const res = applyBenchAction(s, { benchId: "rowan", action: "spotter", rider: "aji" }, roll(15, 24));
  const locked = buildBenchDialogHtml(s, "rowan", { mods: {}, locked: res.act });
  assert.match(locked, /already acted this section/);
  assert.match(buildBenchCardHtml(res.act), /Rowan: Spotter for Aji/);
  const fd = { get: (k) => ({ action: "pit", rider: "violet", skill_pit: "crafting" })[k] ?? null };
  assert.deepEqual(readBenchForm(fd), { action: "pit", rider: "violet", skill: "crafting" });
});

test("the bench dialog ticks the member's best skill by default, not just the first one", () => {
  const s = freshState();
  const reta = { perception: 18, nature: 0, medicine: 0, crafting: 17, diplomacy: 19 };
  const html = buildBenchDialogHtml(s, "reta", { mods: reta });
  assert.match(html, /name="skill_pit" value="crafting" checked/);
  assert.match(html, /name="skill_fix" value="diplomacy" checked/);
  assert.doesNotMatch(html, /name="skill_pit" value="nature" checked/);
});
