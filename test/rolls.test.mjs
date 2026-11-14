import test from "node:test";
import assert from "node:assert/strict";
import { freshState, resolveSection, ROSTER } from "../scripts/engine.mjs";
import {
  degreeOf, lineVp, sectionMenu, validatePcRequest, applyPcCheck, applyNarrows, clearPcRoll, computeMod, eligibleTargets,
  planNpcDice, buildDialogHtml, buildDcCardHtml, buildNpcDiceHtml, buildPcRollHtml, LINES,
} from "../scripts/rolls.mjs";

const d6 = async () => 1 + Math.floor(Math.random() * 6);
const NPCS = ROSTER.filter((r) => !r.pc);
const req = (over = {}) => ({ pcId: "violet", choiceId: "muscle-through:athletics", lineId: "standard", ...over });
const roll = (nat, mod = 20) => ({ nat, mod, parts: [{ label: "skill", value: mod }] });

test("degrees of success follow PF2e, including natural 20 and natural 1", () => {
  assert.equal(degreeOf(40, 30, 10), "critSuccess");   // beat by 10
  assert.equal(degreeOf(30, 30, 10), "success");
  assert.equal(degreeOf(29, 30, 10), "failure");
  assert.equal(degreeOf(20, 30, 10), "critFailure");   // miss by 10
  assert.equal(degreeOf(35, 30, 20), "critSuccess");   // nat 20: success -> crit
  assert.equal(degreeOf(25, 30, 20), "success");       // nat 20: failure -> success
  assert.equal(degreeOf(45, 30, 1), "success");        // nat 1: crit -> success
  assert.equal(degreeOf(32, 30, 1), "failure");        // nat 1: success -> failure
  assert.equal(degreeOf(5, 30, 1), "critFailure");
});

test("VP per line and degree", () => {
  assert.equal(lineVp("safe", "success"), 1);
  assert.equal(lineVp("standard", "critSuccess"), 3);
  assert.equal(lineVp("risky", "success"), 3);
  assert.equal(lineVp("risky", "critSuccess"), 4);
  assert.equal(lineVp("risky", "failure"), 0);
  assert.equal(lineVp("standard", "critFailure"), -1);
});

test("every section has a menu and choice ids are unique inside it", () => {
  for (const lap of [1, 2, 3, 4]) for (const key of ["A", "B", "C", "D"]) {
    const m = sectionMenu(lap, key);
    assert.ok(m.choices.length > 0, `${lap}${key}`);
    const ids = m.choices.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length, `${lap}${key} ids unique`);
  }
});

test("a line roll records the skill as used and gives VP from the line", () => {
  const s = freshState();
  const r = applyPcCheck(s, req({ choiceId: "command-the-drake:nature" }), roll(15, 20));   // 35 vs DC 30: success
  assert.ok(r.ok);
  assert.equal(r.pending.degree, "success");
  assert.equal(r.pending.vp, 2);
  assert.deepEqual(s.used.violet, ["nature"]);
});

test("a skill already used this lap is refused, but another PC may still use it", () => {
  const s = freshState();
  s.used.violet = ["athletics"];
  const v = validatePcRequest(s, req());
  assert.equal(v.ok, false);
  assert.match(v.error, /already been used this lap/);
  assert.equal(validatePcRequest(s, req({ pcId: "aji" })).ok, true);
});

test("a PC can only roll once per section", () => {
  const s = freshState();
  assert.ok(applyPcCheck(s, req({ choiceId: "command-the-drake:nature" }), roll(15)).ok);
  assert.match(validatePcRequest(s, req({ choiceId: "hold-the-line:acrobatics" })).error, /already rolled/);
});

test("Risky needs a drake that isn't Strained, and a failure on Risky drops a rung", () => {
  const s = freshState();
  s.drake.violet = 2;
  assert.match(validatePcRequest(s, req({ lineId: "risky" })).error, /Strained/);
  const t = freshState();
  const r = applyPcCheck(t, req({ lineId: "risky", choiceId: "command-the-drake:nature" }), roll(2, 10));   // 12 vs 32: crit failure
  assert.equal(r.pending.degree, "critFailure");
  assert.equal(r.pending.vp, -1);
  assert.equal(t.drake.violet, 1);
});

test("Flair earns Favor instead of VP", () => {
  const s = freshState();
  const r = applyPcCheck(s, req({ choiceId: "flair:performance", lineId: undefined }), roll(15, 20));      // 35 vs 30
  assert.equal(r.pending.vp, 0);
  assert.equal(s.favor.party, 1);
  const t = freshState();
  applyPcCheck(t, req({ choiceId: "flair:performance" }), roll(20, 20));                                    // nat 20 success -> crit
  assert.equal(t.favor.party, 2);
});

test("a rival effect queues a VP loss for that NPC and clearing the roll removes it", () => {
  const s = freshState();
  const r = applyPcCheck(s, req({ target: "ranto" }), roll(12, 20));      // Muscle through, 32 vs 30 success
  assert.equal(s.pendingAdj.ranto, -1);
  assert.match(r.pending.notes.join(" "), /Ran-to -1 VP/);
  assert.ok(clearPcRoll(s, "violet"));
  assert.equal(s.pendingAdj.ranto, undefined);
  assert.deepEqual(s.used.violet, []);
  assert.equal(s.pending.violet, undefined);
});

test("clearing a roll reverses Favor, drake and influence changes too", () => {
  const s = freshState();
  s.favor.party = 2;
  const before = JSON.stringify({ f: s.favor, d: s.drake, i: s.influence, u: s.used, b: s.bonus });
  s.lap = 4; s.sec = 1;                                                                      // Rings
  applyPcCheck(s, { pcId: "violet", choiceId: "qiu-may-s-silk-smooth:nature", lineId: "risky", spendFavor: true }, roll(20, 20));   // nat 20 -> crit
  assert.equal(s.influence.qiu, 1);
  assert.equal(s.influence.hida, 1);            // crit with the top skill: both sponsors
  assert.equal(s.favor.party, 1);
  clearPcRoll(s, "violet");
  assert.equal(JSON.stringify({ f: s.favor, d: s.drake, i: s.influence, u: s.used, b: s.bonus }), before);
});

test("Favor can't be spent with none, or more than twice a lap", () => {
  const s = freshState();
  assert.match(validatePcRequest(s, req({ spendFavor: true })).error, /no Favor/);
  s.favor.party = 5; s.favor.spent = 2;
  assert.match(validatePcRequest(s, req({ spendFavor: true })).error, /per lap/);
});

test("circumstance bonuses don't stack: the better of bench help and a carried bonus counts", () => {
  const s = freshState();
  s.bonus.violet = 1;
  const m = computeMod(s, "violet", "B", { bench: 2, spendFavor: true }, 20);
  assert.equal(m.total, 20 + 2 + 2 + 1);       // skill + party + best circumstance (2) + Favor
  const n = computeMod(s, "violet", "B", { bench: 0 }, 20);
  assert.equal(n.total, 20 + 2 + 1);           // carried +1 applies
  s.drake.violet = 1;
  assert.equal(computeMod(s, "violet", "A", {}, 20).total, 20 + 2 - 1);   // Winded: -1
});

test("a crit on Hold the line (Entry) carries +1 to the next Obstacle roll, and it is used up", () => {
  const s = freshState();
  applyPcCheck(s, req({ choiceId: "hold-the-line:acrobatics" }), roll(20, 20));   // crit
  assert.equal(s.bonus.violet, 1);
  s.pending = {}; s.sec = 1;                                                       // Obstacle
  applyPcCheck(s, { pcId: "violet", choiceId: "middle-lane:acrobatics" , lineId: undefined }, roll(10, 20));   // acrobatics used? yes -> refused
  assert.equal(s.bonus.violet, 1);
  const t = freshState(); t.bonus.violet = 1; t.sec = 1;
  assert.ok(applyPcCheck(t, { pcId: "violet", choiceId: "high-lane:athletics" }, roll(10, 20)).ok);
  assert.equal(t.bonus.violet, 0);
});

test("Draft only works if you're behind your target", () => {
  const s = freshState();
  s.sec = 2; s.vp.violet = 10; s.vp.ranto = 9;                                     // Violet ahead
  const a = applyPcCheck(s, { pcId: "violet", choiceId: "draft:nature", target: "ranto" }, roll(15, 20));
  assert.equal(a.pending.vp, 0);
  const t = freshState();
  t.sec = 2; t.vp.violet = 8; t.vp.ranto = 9;                                      // Violet behind
  const b = applyPcCheck(t, { pcId: "violet", choiceId: "draft:nature", target: "ranto" }, roll(15, 20));
  assert.equal(b.pending.vp, 1);
});

test("the Narrows: three different skills, strikes and shelter", () => {
  const s = freshState();
  s.lap = 2; s.sec = 1;
  const r = applyNarrows(s, { pcId: "violet", choiceId: "the-narrows-inside-sheltered:narrows", narrows: ["athletics", "acrobatics", "nature"] },
    [{ skill: "athletics", nat: 15, mod: 20 }, { skill: "acrobatics", nat: 12, mod: 20 }, { skill: "nature", nat: 20, mod: 20 }]);   // success, success, crit
  assert.ok(r.ok);
  assert.equal(r.pending.vp, 1 + 1 + 2);
  assert.equal(s.sheltered.violet, true);
  assert.deepEqual(s.used.violet, []);                                              // doesn't count toward no-repeat
  const t = freshState();
  t.lap = 2; t.sec = 1;
  const o = applyNarrows(t, { pcId: "aji", choiceId: "the-narrows-inside-sheltered:narrows", narrows: ["athletics", "perception", "deception"] },
    [{ skill: "athletics", nat: 2, mod: 5 }, { skill: "perception", nat: 3, mod: 5 }, { skill: "deception", nat: 18, mod: 20 }]);     // fail, fail, success
  assert.equal(o.pending.vp, 1 - 1);                                                // +1 success, -1 thrown out
  assert.equal(t.sheltered.aji, false);
  assert.match(validatePcRequest(t, { pcId: "violet", choiceId: "the-narrows-inside-sheltered:narrows", narrows: ["athletics", "athletics", "nature"] }).error, /three different/);
});

test("the section roll uses the PCs' pending rolls and clears them; used skills reset on a new lap", async () => {
  const s = freshState();
  applyPcCheck(s, req({ choiceId: "command-the-drake:nature" }), roll(15, 20));    // +2 VP
  applyPcCheck(s, { pcId: "aji", choiceId: "flair:performance" }, roll(15, 20));   // Favor, 0 VP
  await resolveSection(s, {}, d6);                                                  // no totals typed: use the rolls
  assert.equal(s.vp.violet, 2);
  assert.equal(s.vp.aji, 0);
  assert.deepEqual(s.pending, {});
  assert.deepEqual(s.used.violet, ["nature"]);                                      // same lap, still used
  for (let i = 0; i < 3; i++) await resolveSection(s, {}, d6);                      // finish the lap
  assert.equal(s.lap, 2);
  assert.deepEqual(s.used, { violet: [], aji: [] });
  assert.equal(s.favor.spent, 0);
});

test("queued rival VP is applied to the NPC on the next section roll", async () => {
  const s = freshState();
  applyPcCheck(s, req({ target: "syu" }), roll(12, 20));                           // Muscle through succeeds on Syu
  await resolveSection(s, {}, d6);
  assert.equal(s.delta.syu, s.lapRolls.syu.a - 1, "Syu's section gain is his Entry share minus the point the PC took");
  assert.deepEqual(s.pendingAdj, {});
});

test("Hold the line cancels an attack on that PC, and a crit bumps the attacker", async () => {
  let cancelled = 0, bumped = 0;
  for (let i = 0; i < 300; i++) {
    const s = freshState();
    s.sec = 2; s.lap = 1;
    s.vp = Object.fromEntries(ROSTER.map((r) => [r.id, 10]));
    s.pending.violet = { vp: 0, hold: i % 2 ? 2 : 1, summary: "Hold the line" };
    s.pending.aji = { vp: 0, hold: 0, summary: "test" };
    const rep = await resolveSection(s, {}, async () => 6);                          // every attack hits
    const notes = Object.values(rep.notes).flat().join(" ");
    if (/Violet held the line/.test(notes)) { cancelled++; if (/crit bumps/.test(notes)) bumped++; }
    const unheld = /Attacks Violet/.test(notes) && !/Violet held the line/.test(notes);
    if (unheld) assert.equal(s.vp.violet, 9, "an unheld hit costs Violet 1 VP");
  }
  assert.ok(cancelled > 0 && bumped > 0);
});

test("NPC dice: each NPC rolls their best skill, and personality sets the DC", () => {
  const modFor = (n, sk) => n.skills[sk] ?? 0;
  const plan = planNpcDice(NPCS, 1, "A", modFor);
  const byId = Object.fromEntries(plan.map((p) => [p.id, p]));
  assert.equal(byId.viridian.skill, "deception");     // her best of the Entry skills (+28)
  assert.equal(byId.ranto.skill, "athletics");        // +30
  assert.equal(byId.syu.dc, LINES.risky.dc);          // aggressive
  assert.equal(byId.ivory.dc, LINES.safe.dc);         // cautious
  assert.equal(byId.sarah.dc, LINES.standard.dc);
  const battle = planNpcDice(NPCS, 1, "C", modFor, new Set(["syu"]));
  assert.equal(battle.find((p) => p.id === "syu").lineLabel, "Attack");
  assert.ok(battle.every((p) => p.dc === 30));
});

test("the roll dialog strikes through and disables used skills, and shows what each choice does", () => {
  const s = freshState();
  s.used.violet = ["athletics"];
  const html = buildDialogHtml(s, "violet", sectionMenu(1, "A"), { mods: { athletics: 23, nature: 18 }, targets: [{ id: "syu", name: "Syu Tak-nwa", total: 2 }], key: "A" });
  assert.match(html, /<s>Athletics<\/s>/);
  assert.match(html, /used this lap/);
  assert.match(html, /value="muscle-through:athletics" disabled/);
  assert.doesNotMatch(html, /value="command-the-drake:nature" disabled/);                // an unused skill is selectable
  assert.match(html, /Rile up the crowd/);                                              // Flair explains itself
  assert.match(html, /Syu Tak-nwa \(2 VP\)/);
  assert.match(html, /\+18/);
  assert.match(html, /class="skill">Nature/);                                            // the skill is the row's headline
});

test("the three lines are panels with the payout for every degree", () => {
  const html = buildDialogHtml(freshState(), "violet", sectionMenu(1, "A"), { key: "A" });
  assert.equal((html.match(/class="srt-pick srt-line /g) ?? []).length, 3);
  assert.match(html, /srt-line safe/); assert.match(html, /srt-line standard/); assert.match(html, /srt-line risky/);
  assert.match(html, /Critical success/); assert.match(html, /Critical failure/);
  assert.match(html, /drake drops a rung/);
  assert.match(html, /value="standard" checked/);
  assert.doesNotMatch(buildDialogHtml(freshState(), "violet", sectionMenu(1, "B"), { key: "B" }), /srt-lines/);   // lanes have no line panels
});

test("a Strained drake can't pick the Risky line in the dialog", () => {
  const s = freshState(); s.drake.violet = 2;
  const html = buildDialogHtml(s, "violet", sectionMenu(1, "D"), { key: "D" });
  assert.match(html, /value="risky" {0,2}disabled/);
  assert.match(html, /srt-line risky off/);
});

test("the DC card has the lines and a Roll button tied to the section", () => {
  const html = buildDcCardHtml(freshState(), 1, "A");
  assert.match(html, /DC 28/); assert.match(html, /DC 30/); assert.match(html, /DC 32/);
  assert.match(html, /data-srt-action="roll" data-lap="1" data-key="A"/);
  assert.match(buildDcCardHtml(freshState(), 1, "B"), /Bell Gate/);
});

test("chat card builders produce text for NPCs and PCs", () => {
  const npc = buildNpcDiceHtml(1, "A", [{ name: "Syu Tak-nwa", lineLabel: "All-out", skill: "deception", mod: 27, dc: 32, nat: 15, total: 42, degree: "critSuccess" }]);
  assert.match(npc, /Syu Tak-nwa/); assert.match(npc, /Critical Success/);
  const pc = buildPcRollHtml({ pcName: "Violet", choice: sectionMenu(1, "A").choices[2], lineId: "standard", dc: 30, nat: 14, parts: [{ label: "skill", value: 23 }, { label: "party", value: 2 }], total: 39, degree: "success", vp: 2, notes: [] });
  assert.match(pc, /Violet/); assert.match(pc, /\+2 VP/);
});

test("eligible targets are NPCs within 2 VP, never a teammate", () => {
  const s = freshState();
  s.vp.violet = 10; s.vp.aji = 10; s.vp.syu = 11; s.vp.ranto = 7; s.vp.ivory = 12; s.vp.sarah = 8;
  const ids = eligibleTargets(s, "violet").map((t) => t.id).sort();
  assert.deepEqual(ids, ["ivory", "sarah", "syu"].sort());
  assert.ok(!ids.includes("aji"));
});

test("manual VP mode: a roll shows the degree and suggests VP, but the GM sets the VP", async () => {
  const s = freshState();
  const r = applyPcCheck(s, req({ choiceId: "command-the-drake:nature" }), roll(15, 20), { autoVp: false });   // success
  assert.equal(r.pending.suggested, 2);
  assert.equal(r.pending.vp, 0);
  assert.equal(r.pending.auto, false);
  assert.match(r.pending.summary, /suggests \+2 VP/);
  assert.deepEqual(s.used.violet, ["nature"]);                          // the skill still counts as used
  await resolveSection(s, {}, d6);                                       // nothing typed: no VP given
  assert.equal(s.vp.violet, 0);
  const t = freshState();
  applyPcCheck(t, req({ choiceId: "command-the-drake:nature" }), roll(15, 20), { autoVp: false });
  await resolveSection(t, { violet: 3 }, d6);                           // the GM types +3 (a crit's worth)
  assert.equal(t.vp.violet, 3);
});

test("manual VP mode still applies the non-VP effects (Favor, drake, rival adjustments)", () => {
  const s = freshState();
  applyPcCheck(s, req({ choiceId: "flair:performance" }), roll(15, 20), { autoVp: false });
  assert.equal(s.favor.party, 1);
  const t = freshState();
  applyPcCheck(t, req({ target: "ranto" }), roll(12, 20), { autoVp: false });
  assert.equal(t.pendingAdj.ranto, -1);
});

test("the cards say when VP is only a suggestion", () => {
  const choice = sectionMenu(1, "A").choices[2];
  const base = { pcName: "Violet", choice, lineId: "standard", dc: 30, nat: 14, parts: [{ label: "skill", value: 23 }], total: 37, degree: "success", vp: 2, notes: [] };
  assert.match(buildPcRollHtml({ ...base, auto: false }), /Suggested: \+2 VP/);
  assert.match(buildPcRollHtml({ ...base, auto: true }), /<b>\+2 VP<\/b>/);
});
