/**
 * Dice, DCs and PC checks for the Sky Regatta. Pure JavaScript (no Foundry), so it is unit tested.
 * Rules come from sky-regatta-race-plan.md (sections 2, 4 and 5).
 */
import { ROSTER, SECTION_NAME, OBSTACLE, normalizeState, signed, esc } from "./engine.mjs";

export const PARTY_BONUS = 2;      // untyped bonus the party carries into every race roll
export const BATTLE_DC = 30;
export const NARROWS_DC = 30;
export const MAX_FAVOR_SPEND_PER_LAP = 2;

export const SKILL_LABEL = {
  acrobatics: "Acrobatics", athletics: "Athletics", nature: "Nature", survival: "Survival", performance: "Performance",
  deception: "Deception", intimidation: "Intimidation", perception: "Perception", diplomacy: "Diplomacy",
};
export const LINES = {
  safe:     { id: "safe",     label: "Hold pace", dc: 28, vp: [1, 2] },
  standard: { id: "standard", label: "Push",      dc: 30, vp: [2, 3] },
  risky:    { id: "risky",    label: "All-out",   dc: 32, vp: [3, 4] },
};
export const DRAKE_STATES = ["Fresh", "Winded", "Strained", "Spent"];
const DRAKE_PENALTY = [0, -1, -2, 0];
export const drakePenalty = (rung) => DRAKE_PENALTY[rung] ?? 0;

// ---------- degrees of success (PF2e) ----------
export const DEGREE_LABEL = { critSuccess: "Critical Success", success: "Success", failure: "Failure", critFailure: "Critical Failure" };
export const DEGREE_COLOR = { critSuccess: "#3ddc84", success: "#9bd96b", failure: "#ff9f43", critFailure: "#ff5a5a" };

/** PF2e: beat the DC by 10 for a crit, miss by 10 for a crit failure; a natural 20 or 1 moves it one step. */
export function degreeOf(total, dc, nat) {
  let step = total >= dc + 10 ? 3 : total >= dc ? 2 : total > dc - 10 ? 1 : 0;
  if (nat === 20) step = Math.min(3, step + 1);
  if (nat === 1) step = Math.max(0, step - 1);
  return ["critFailure", "failure", "success", "critSuccess"][step];
}
export function lineVp(lineId, degree) {
  const L = LINES[lineId];
  return degree === "critSuccess" ? L.vp[1] : degree === "success" ? L.vp[0] : degree === "critFailure" ? -1 : 0;
}

// ---------- what each section lets a rider do ----------
const slug = (str) => str.toLowerCase().replace(/[^a-z]+/g, "-").replace(/^-|-$/g, "");
function mk(group, skill, desc, extra = {}) { return { id: `${slug(group)}:${skill}`, group, skill, desc, fx: {}, ...extra }; }
const RIVAL = { success: { rival: -1 }, critSuccess: { rival: -1 } };

const ENTRY = [
  mk("Command the drake", "nature", "Crit: your drake climbs a rung.", { fx: { critSuccess: { drake: -1 } } }),
  mk("Hold the line", "acrobatics", "Crit: +1 circumstance bonus on your Obstacle roll.", { fx: { critSuccess: { bonusNext: 1 } } }),
  mk("Muscle through", "athletics", "Success: one rival loses 1 VP. Crit failure: your drake drops a rung.", { target: true, fx: { ...RIVAL, critFailure: { drake: 1 } } }),
  mk("Read the wind", "survival", "Crit: you learn the Obstacle's best lane.", { fx: { critSuccess: { note: "You read the wind: the GM tells you the Obstacle's best lane." } } }),
  mk("Flair", "performance", "Rile up the crowd! Success: 1 Favor instead of VP (crit: 2). No line needed.", { noLine: true, noVp: true, fx: { success: { favor: 1 }, critSuccess: { favor: 2 } } }),
  mk("Psych out", "deception", "Success: one rival loses 1 VP. Crit failure: you lose 1 Favor.", { target: true, fx: { ...RIVAL, critFailure: { favor: -1 } } }),
  mk("Psych out", "intimidation", "Success: one rival loses 1 VP. Crit failure: you lose 1 Favor.", { target: true, fx: { ...RIVAL, critFailure: { favor: -1 } } }),
];
const SPRINT = [
  mk("Sprint: Nature", "nature", "Crit: your drake climbs a rung.", { fx: { critSuccess: { drake: -1 } } }),
  mk("Sprint: Athletics", "athletics", "Raw power down the straight."),
  mk("Sprint: Survival", "survival", "Read the air and ride the best currents."),
  mk("Sprint: Acrobatics", "acrobatics", "Take the racing line."),
];
const lane = (group, skill, lineId, desc, extra = {}) => mk(group, skill, desc, { line: lineId, ...extra });
const BELL_GATE = [
  lane("High lane", "athletics", "safe", "Slam the big low bell for a wide gate. Crit failure: you hit the ward and your drake drops a rung.", { fx: { critFailure: { drake: 1 } } }),
  lane("Middle lane", "acrobatics", "standard", "Strike the main bell for a clean, medium gate. Crit failure: you hit the ward and your drake drops a rung.", { fx: { critFailure: { drake: 1 } } }),
  lane("Low lane", "performance", "risky", "Ring the whole row for a narrow, fast gate. A success earns 1 Favor. Crit failure: your drake drops a rung.", { fx: { success: { favor: 1 }, critSuccess: { favor: 1 }, critFailure: { drake: 1 } } }),
];
const CABLE_WEB = [
  lane("High lane", "athletics", "safe", "Haul the drake up and over the top. Crit failure: the drake scrapes a cable and drops a rung.", { fx: { critFailure: { drake: 1 } } }),
  lane("Middle lane", "acrobatics", "standard", "Thread the wider gaps. Crit failure: the drake scrapes a cable and drops a rung.", { fx: { critFailure: { drake: 1 } } }),
  lane("Low lane", "perception", "risky", "Dive through the tightest gap, the fastest line. Crit failure: the drake scrapes a cable and drops a rung.", { fx: { critFailure: { drake: 1 } } }),
];
const RINGS = [
  mk("Qiu May's silk (smooth)", "nature", "A clean, gentle pass. Success: 1 Influence with Lady Qiu May. A crit with Nature: Influence with both sponsors.", { patron: "qiu", top: true, fx: { critFailure: { drake: 1 } } }),
  mk("Qiu May's silk (smooth)", "acrobatics", "A clean, gentle pass. Success: 1 Influence with Lady Qiu May.", { patron: "qiu", fx: { critFailure: { drake: 1 } } }),
  mk("Hida's steel (disciplined)", "athletics", "A tight, aggressive pass. Success: 1 Influence with General Hida. A crit with Athletics: Influence with both sponsors.", { patron: "hida", top: true, fx: { critFailure: { drake: 1 } } }),
  mk("Hida's steel (disciplined)", "intimidation", "A tight, aggressive pass. Success: 1 Influence with General Hida.", { patron: "hida", fx: { critFailure: { drake: 1 } } }),
];
const NARROWS = mk("The Narrows (inside, sheltered)", "narrows", "Three checks at DC 30, each with a DIFFERENT skill. A success is +1 VP, a crit +2, and a failure is a strike. Two strikes: -1 VP and no shelter. Sheltered riders can't be targeted in Battle. These checks don't count toward the no-repeat rule.", { special: "narrows" });
const DIP = ["athletics", "acrobatics", "nature", "survival"].map((sk) => mk("The Dip (outside, exposed)", sk, "One roll with the usual line choice. You enter Battle unsheltered."));
const BATTLE = [
  mk("Bump", "athletics", "Success: your target loses 1 VP. Crit: their drake also drops a rung.", { battle: true, target: true, fx: { success: { rival: -1 }, critSuccess: { rival: -1, note: "Their drake drops a rung." } } }),
  mk("Cut off", "acrobatics", "Success: your target loses 1 VP and you gain 1. Crit: they also can't attack you this lap.", { battle: true, target: true, fx: { success: { rival: -1, self: 1 }, critSuccess: { rival: -1, self: 1, note: "They can't attack you this lap." } } }),
  ...["deception", "intimidation", "performance"].map((sk) => mk("Distract", sk, "Success: your target loses 1 VP. Crit: they also take -1 to their next roll.", { battle: true, target: true, fx: { success: { rival: -1 }, critSuccess: { rival: -1, note: "They take -1 to their next roll." } } })),
  mk("Draft", "nature", "Only if you're behind your target. Success: +1 VP. Crit: +2 VP.", { battle: true, target: true, needsBehind: true, fx: { success: { self: 1 }, critSuccess: { self: 2 } } }),
  ...["athletics", "acrobatics", "nature", "survival", "deception", "intimidation", "performance"].map((sk) => mk("Hold the line", sk, "Success: cancel one attack on you this lap. Crit: cancel it and bump the attacker (-1 VP).", { battle: true, fx: { success: { hold: 1 }, critSuccess: { hold: 2 } } })),
];

/** Everything a rider can pick for the given section. */
export function sectionMenu(lap, key) {
  const lines = ["safe", "standard", "risky"];
  if (key === "A") return { type: "approach", title: "Entry", intro: "Pick a line, then how you ride it.", lines, choices: ENTRY };
  if (key === "D") return { type: "approach", title: "Sprint", intro: "Pick a line, then how you ride it.", lines, choices: SPRINT };
  if (key === "C") return { type: "battle", title: "Battle", intro: `Take one battle action against a rival within 2 VP (DC ${BATTLE_DC}).`, lines: null, choices: BATTLE };
  const title = `Obstacle: ${OBSTACLE[lap]}`;
  if (lap === 1) return { type: "lane", title, intro: "Pick a lane. Each lane has its own skill and DC.", lines: null, choices: BELL_GATE };
  if (lap === 3) return { type: "lane", title, intro: "Pick a lane. Each lane has its own skill and DC.", lines: null, choices: CABLE_WEB };
  if (lap === 2) return { type: "hall", title, intro: "Choose your route. The Dip needs a line; the Narrows is three checks.", lines, choices: [NARROWS, ...DIP] };
  return { type: "approach", title, intro: "Pick a patron, a skill and a line.", lines, choices: RINGS };
}

/** The rules each choice follows, derived from its fields. */
const isLineRoll = (c) => !c.battle && !c.special;     // counts toward the no-repeat rule
const needsLine = (menu, c) => menu.lines && !c.noLine && !c.special && !c.line && !c.battle;
export const choiceDc = (menu, c, lineId) => (c.battle ? BATTLE_DC : c.special === "narrows" ? NARROWS_DC : c.line ? LINES[c.line].dc : c.noLine ? LINES.standard.dc : LINES[lineId]?.dc);

// ---------- state helpers ----------
export const totalNow = (state, id) => (state.vp[id] ?? 0) + (state.pending?.[id]?.vp ?? 0);
export const riderName = (id) => ROSTER.find((r) => r.id === id)?.name ?? id;
export const skillUsed = (state, pcId, skill) => (state.used?.[pcId] ?? []).includes(skill);

/** NPCs a PC may target: within 2 VP, and not sheltered in Battle (laps 1-3). */
export function eligibleTargets(state, pcId) {
  const mine = totalNow(state, pcId);
  const myTeam = ROSTER.find((r) => r.id === pcId)?.team;
  return ROSTER.filter((r) => !r.pc && r.team !== myTeam && Math.abs(state.vp[r.id] - mine) <= 2)
    .map((r) => ({ id: r.id, name: r.name, total: state.vp[r.id] }));
}

/** The numbers added to a PC's d20: skill, party bonus, drake condition, bench help, Favor and carried bonuses. */
export function computeMod(state, pcId, key, req, skillMod) {
  const parts = [{ label: "skill", value: skillMod }, { label: "party", value: PARTY_BONUS }];
  const pen = drakePenalty(state.drake?.[pcId] ?? 0);
  if (pen) parts.push({ label: `drake (${DRAKE_STATES[state.drake[pcId]]})`, value: pen });
  const carried = key === "B" ? (state.bonus?.[pcId] ?? 0) : 0;
  const circ = Math.max(Number(req.bench) || 0, carried);     // circumstance bonuses don't stack: the best one counts
  if (circ) parts.push({ label: "circumstance", value: circ });
  if (req.spendFavor) parts.push({ label: "Favor", value: 1 });
  return { parts, total: parts.reduce((a, p) => a + p.value, 0), usedCarried: carried > 0 && circ === carried };
}

/** Checks a request against the current state. Returns { ok, error } or { ok, menu, choice, lineId, dc }. */
export function validatePcRequest(state, req) {
  normalizeState(state);
  const pc = ROSTER.find((r) => r.id === req.pcId && r.pc);
  if (!pc) return { ok: false, error: "That rider isn't in the race." };
  if (state.lap > 4) return { ok: false, error: "The race is over." };
  if (req.lap !== undefined && (req.lap !== state.lap || req.key !== ["A", "B", "C", "D"][state.sec])) {
    return { ok: false, error: "That roll is for a different section. Open the roll from the tower for the current one." };
  }
  const key = ["A", "B", "C", "D"][state.sec];
  if (state.pending[pc.id]) return { ok: false, error: `${pc.name} has already rolled this section.` };
  if ((state.drake[pc.id] ?? 0) >= 3) return { ok: false, error: `${pc.name}'s drake is Spent and out of the race.` };
  const menu = sectionMenu(state.lap, key);
  const choice = menu.choices.find((c) => c.id === req.choiceId);
  if (!choice) return { ok: false, error: "Pick one of the options." };
  if (isLineRoll(choice) && skillUsed(state, pc.id, choice.skill)) return { ok: false, error: `${SKILL_LABEL[choice.skill]} has already been used this lap.` };
  let lineId = choice.line ?? (choice.noLine ? "standard" : req.lineId);
  if (needsLine(menu, choice) && !LINES[lineId]) return { ok: false, error: "Pick a line." };
  if (lineId === "risky" && (state.drake[pc.id] ?? 0) >= 2) return { ok: false, error: "A Strained drake can't take a Risky line." };
  if (req.spendFavor) {
    if ((state.favor.party ?? 0) < 1) return { ok: false, error: "The party has no Favor to spend." };
    if ((state.favor.spent ?? 0) >= MAX_FAVOR_SPEND_PER_LAP) return { ok: false, error: `Only ${MAX_FAVOR_SPEND_PER_LAP} Favor can be spent per lap.` };
  }
  if (choice.special === "narrows") {
    const picks = [...new Set(req.narrows ?? [])];
    if (picks.length !== 3 || picks.some((s) => !SKILL_LABEL[s])) return { ok: false, error: "Pick three different skills for the Narrows." };
  }
  return { ok: true, menu, choice, lineId: choice.special ? undefined : lineId, dc: choiceDc(menu, choice, lineId), key };
}

/** Applies one effect bundle to the state and returns what changed so it can be undone. */
function applyEffect(state, pcId, fx, ctx, change, notes) {
  if (!fx) return;
  if (fx.favor) { const before = state.favor.party; state.favor.party = Math.max(0, before + fx.favor); change.favor += state.favor.party - before; notes.push(`${signed(fx.favor)} Favor`); }
  if (fx.drake) ctx.drake = fx.drake;                 // resolved once at the end so a roll never drops two rungs
  if (fx.self) { ctx.self += fx.self; }
  if (fx.rival) {
    if (ctx.target) { state.pendingAdj[ctx.target] = (state.pendingAdj[ctx.target] ?? 0) + fx.rival; change.adj[ctx.target] = (change.adj[ctx.target] ?? 0) + fx.rival; notes.push(`${riderName(ctx.target)} ${signed(fx.rival)} VP`); }
    else notes.push("No rival picked: no VP taken.");
  }
  if (fx.hold) ctx.hold = Math.max(ctx.hold, fx.hold);
  if (fx.bonusNext) { change.bonusSet = fx.bonusNext; }
  if (fx.note) notes.push(fx.note);
}

/** Records a PC's finished d20 as their pending roll for this section and applies its effects. */
export function applyPcCheck(state, req, roll) {
  const v = validatePcRequest(state, req);
  if (!v.ok) return v;
  const { choice, lineId, dc, key } = v;
  const pcId = req.pcId;
  const total = roll.nat + roll.mod;
  const degree = degreeOf(total, dc, roll.nat);
  const notes = [];
  const change = { favor: 0, drake: 0, adj: {}, influence: { qiu: 0, hida: 0 }, bonusSet: 0, usedSkill: null, bonusSpent: 0, favorSpent: 0, sheltered: undefined };
  const ctx = { drake: 0, self: 0, hold: 0, target: req.target || null };

  let vp = choice.noVp || choice.battle ? 0 : lineVp(lineId, degree);
  if (lineId === "risky" && (degree === "failure" || degree === "critFailure")) ctx.drake = Math.max(ctx.drake, 1);
  applyEffect(state, pcId, choice.fx[degree], ctx, change, notes);

  if (choice.needsBehind && ctx.self) {
    const tgt = ctx.target ? totalNow(state, ctx.target) : null;
    if (tgt === null || !(totalNow(state, pcId) < tgt)) { notes.push("Draft needs you to be behind your target: no gain."); ctx.self = 0; }
  }
  if (choice.patron && (degree === "success" || degree === "critSuccess")) {
    const both = degree === "critSuccess" && choice.top;
    const gets = both ? ["qiu", "hida"] : [choice.patron];
    for (const g of gets) { state.influence[g] += 1; change.influence[g] += 1; }
    notes.push(`+1 Influence with ${gets.map((g) => (g === "qiu" ? "Lady Qiu May" : "General Hida")).join(" and ")}`);
  }
  vp += ctx.self;

  // drake condition: at most one rung down per roll, or one up for a crit
  if (ctx.drake > 0) { const b = state.drake[pcId]; state.drake[pcId] = Math.min(3, b + 1); change.drake = state.drake[pcId] - b; notes.push(`Drake drops a rung (${DRAKE_STATES[state.drake[pcId]]})`); }
  else if (ctx.drake < 0) { const b = state.drake[pcId]; state.drake[pcId] = Math.max(0, b - 1); change.drake = state.drake[pcId] - b; if (change.drake) notes.push(`Drake climbs a rung (${DRAKE_STATES[state.drake[pcId]]})`); }

  // costs and carried bonuses
  if (req.spendFavor) { state.favor.party -= 1; state.favor.spent += 1; change.favor -= 1; change.favorSpent = 1; }
  const prevBonus = state.bonus[pcId] ?? 0;
  if (key === "B" && prevBonus) { state.bonus[pcId] = 0; change.bonusSpent = prevBonus; }
  if (change.bonusSet) { change.bonusPrev = state.bonus[pcId]; state.bonus[pcId] = change.bonusSet; notes.push("+1 circumstance bonus on your Obstacle roll"); }
  if (isLineRoll(choice)) { state.used[pcId].push(choice.skill); change.usedSkill = choice.skill; }

  const line = lineId ? `${LINES[lineId].label} (DC ${dc})` : `DC ${dc}`;
  const summary = `${choice.group} (${SKILL_LABEL[choice.skill] ?? choice.skill}), ${line}: ${total} ${DEGREE_LABEL[degree]} → ${signed(vp)} VP`;
  state.pending[pcId] = {
    lap: state.lap, key, choiceId: choice.id, group: choice.group, skill: choice.skill, lineId: lineId ?? null, dc,
    nat: roll.nat, mod: roll.mod, total, degree, vp, hold: ctx.hold, notes, summary, undo: change, target: ctx.target,
  };
  return { ok: true, pending: state.pending[pcId], parts: roll.parts ?? [] };
}

/** The Narrows: three checks, three different skills. rolls = [{ skill, nat, mod }, ...]. */
export function applyNarrows(state, req, rolls) {
  const v = validatePcRequest(state, req);
  if (!v.ok) return v;
  if (v.choice.special !== "narrows") return { ok: false, error: "That isn't the Narrows." };
  const pcId = req.pcId;
  let vp = 0, strikes = 0;
  const checks = rolls.map((r) => {
    const total = r.nat + r.mod;
    const degree = degreeOf(total, NARROWS_DC, r.nat);
    if (degree === "critSuccess") vp += 2; else if (degree === "success") vp += 1; else strikes += 1;
    return { skill: r.skill, nat: r.nat, mod: r.mod, total, degree };
  });
  const out = strikes >= 2;
  if (out) vp -= 1;
  const notes = [`${strikes} strike${strikes === 1 ? "" : "s"}${out ? ": thrown out of the Narrows (-1 VP, no shelter)" : ": still sheltered"}`];
  const change = { favor: 0, drake: 0, adj: {}, influence: { qiu: 0, hida: 0 }, bonusSet: 0, usedSkill: null, bonusSpent: 0, favorSpent: 0, shelteredPrev: !!state.sheltered[pcId] };
  if (req.spendFavor) { state.favor.party -= 1; state.favor.spent += 1; change.favor -= 1; change.favorSpent = 1; }
  state.sheltered[pcId] = !out;
  const summary = `The Narrows: ${checks.map((c) => `${SKILL_LABEL[c.skill]} ${c.total} ${DEGREE_LABEL[c.degree]}`).join("; ")} → ${signed(vp)} VP`;
  state.pending[pcId] = { lap: state.lap, key: "B", choiceId: v.choice.id, group: v.choice.group, skill: "narrows", lineId: null, dc: NARROWS_DC, checks, vp, hold: 0, notes, summary, undo: change, degree: out ? "failure" : "success" };
  return { ok: true, pending: state.pending[pcId], checks };
}

/** Takes a PC's pending roll back (a mistake, or a re-roll the GM allows). */
export function clearPcRoll(state, pcId) {
  const p = state.pending?.[pcId];
  if (!p) return false;
  const u = p.undo;
  state.favor.party = Math.max(0, state.favor.party - (u.favor ?? 0));
  state.favor.spent = Math.max(0, state.favor.spent - (u.favorSpent ?? 0));
  if (u.drake) state.drake[pcId] = Math.min(3, Math.max(0, state.drake[pcId] - u.drake));
  for (const [id, n] of Object.entries(u.adj ?? {})) { state.pendingAdj[id] = (state.pendingAdj[id] ?? 0) - n; if (!state.pendingAdj[id]) delete state.pendingAdj[id]; }
  for (const g of ["qiu", "hida"]) state.influence[g] = Math.max(0, state.influence[g] - (u.influence?.[g] ?? 0));
  if (u.bonusSet) state.bonus[pcId] = u.bonusPrev ?? 0;
  if (u.bonusSpent) state.bonus[pcId] = u.bonusSpent;
  if (u.usedSkill) { const i = state.used[pcId].lastIndexOf(u.usedSkill); if (i >= 0) state.used[pcId].splice(i, 1); }
  if (u.shelteredPrev !== undefined) state.sheltered[pcId] = u.shelteredPrev;
  delete state.pending[pcId];
  return true;
}

// ---------- NPC dice theatre ----------
/** The skills an NPC might roll in each section, used only for the dice show. */
export function npcSkillOptions(lap, key, isAttacker) {
  if (key === "A") return [["nature", null], ["acrobatics", null], ["athletics", null], ["survival", null], ["deception", null], ["intimidation", null]];
  if (key === "D") return [["nature", null], ["athletics", null], ["survival", null], ["acrobatics", null]];
  if (key === "C") return isAttacker ? [["athletics", null], ["acrobatics", null], ["deception", null], ["intimidation", null]] : [["nature", null], ["acrobatics", null], ["athletics", null]];
  const menu = sectionMenu(lap, "B");
  const out = [];
  for (const c of menu.choices) if (c.skill !== "narrows") out.push([c.skill, c.line ?? null]);
  return out;
}
/** Picks each NPC's skill and DC for the show: personality sets the line, the best modifier picks the skill. */
export function planNpcDice(npcs, lap, key, modFor, attackerIds = new Set()) {
  return npcs.map((n) => {
    const lineId = n.tag === "aggressive" ? "risky" : n.tag === "cautious" ? "safe" : "standard";
    const opts = npcSkillOptions(lap, key, attackerIds.has(n.id));
    let best = null;
    for (const [skill, fixedLine] of opts) {
      const line = key === "C" ? null : (fixedLine ?? lineId);
      const dc = key === "C" ? BATTLE_DC : LINES[line].dc;
      const mod = modFor(n, skill);
      const margin = mod - dc;
      if (!best || margin > best.margin) best = { skill, line, dc, mod, margin };
    }
    return { id: n.id, name: n.name, skill: best.skill, mod: best.mod, dc: best.dc, lineLabel: best.line ? LINES[best.line].label : (attackerIds.has(n.id) ? "Attack" : "Hold the line") };
  });
}

// ---------- HTML for chat cards and dialogs ----------
const sectionTitle = (lap, key) => `Lap ${lap}, ${key} · ${SECTION_NAME[key]}${key === "B" ? ` (${OBSTACLE[lap]})` : ""}`;

export function buildNpcDiceHtml(lap, key, rows) {
  const lines = rows.map((r) => {
    const col = DEGREE_COLOR[r.degree];
    return `<div style="margin:2px 0"><b>${esc(r.name)}</b> <small>${esc(r.lineLabel)}, ${esc(SKILL_LABEL[r.skill])} ${signed(r.mod)}, DC ${r.dc}</small><br>`
      + `&nbsp;&nbsp;d20 ${r.nat} ${signed(r.mod)} = <b>${r.total}</b> <span style="color:${col};font-weight:bold">${DEGREE_LABEL[r.degree]}</span></div>`;
  }).join("");
  return `<h4 style="margin:0 0 4px 0">The field rolls: ${esc(sectionTitle(lap, key))}</h4>${lines}`;
}

export function buildDcCardHtml(state, lap, key) {
  const menu = sectionMenu(lap, key);
  const rows = [];
  if (menu.type === "lane") {
    for (const c of menu.choices) rows.push(`<li><b>${esc(c.group)}</b> (${SKILL_LABEL[c.skill]}): ${LINES[c.line].label}, <b>DC ${LINES[c.line].dc}</b>, ${LINES[c.line].vp[0]} VP (crit ${LINES[c.line].vp[1]})</li>`);
  } else if (menu.type === "battle") {
    rows.push(`<li>Battle actions: <b>DC ${BATTLE_DC}</b> (Bump, Cut off, Distract, Draft, Hold the line)</li>`);
  } else {
    for (const L of Object.values(LINES)) rows.push(`<li>${L.label}: <b>DC ${L.dc}</b>, ${L.vp[0]} VP (crit ${L.vp[1]})</li>`);
    if (menu.type === "hall") rows.push(`<li>The Narrows: three checks at <b>DC ${NARROWS_DC}</b>, three different skills</li>`);
  }
  const used = ["violet", "aji"].map((id) => `${riderName(id)}: ${(state.used?.[id] ?? []).map((s) => SKILL_LABEL[s]).join(", ") || "nothing yet"}`).join(" · ");
  return `<div class="srt-dc-card"><h3 style="margin:0 0 4px 0">Sky Regatta: ${esc(sectionTitle(lap, key))}</h3><ul style="margin:0 0 6px 16px">${rows.join("")}</ul>`
    + (menu.type === "battle" ? "" : `<p style="margin:0 0 6px 0"><small>Skills already used this lap (no repeats): ${esc(used)}</small></p>`)
    + `<button type="button" data-srt-action="roll" data-lap="${lap}" data-key="${key}"><i class="fa-solid fa-dice-d20"></i> Roll my check</button></div>`;
}

export function buildPcRollHtml({ pcName, choice, lineId, dc, nat, parts, total, degree, vp, notes }) {
  const col = DEGREE_COLOR[degree];
  const bonus = parts.map((p) => `${signed(p.value)} ${esc(p.label)}`).join(", ");
  const how = lineId ? `${LINES[lineId].label}, DC ${dc}` : `DC ${dc}`;
  return `<h4 style="margin:0 0 4px 0">${esc(pcName)}: ${esc(choice.group)} <small>(${esc(SKILL_LABEL[choice.skill] ?? choice.skill)})</small></h4>`
    + `<div>${esc(how)}</div><div>d20 ${nat} (${bonus}) = <b>${total}</b> <span style="color:${col};font-weight:bold">${DEGREE_LABEL[degree]}</span></div>`
    + `<div><b>${signed(vp)} VP</b>${notes.length ? ` · ${notes.map(esc).join(" · ")}` : ""}</div>`;
}

export function buildNarrowsHtml({ pcName, checks, vp, notes }) {
  const rows = checks.map((c) => `<div>${esc(SKILL_LABEL[c.skill])}: d20 ${c.nat} ${signed(c.mod)} = <b>${c.total}</b> <span style="color:${DEGREE_COLOR[c.degree]};font-weight:bold">${DEGREE_LABEL[c.degree]}</span></div>`).join("");
  return `<h4 style="margin:0 0 4px 0">${esc(pcName)}: The Narrows <small>(DC ${NARROWS_DC})</small></h4>${rows}<div><b>${signed(vp)} VP</b> · ${notes.map(esc).join(" · ")}</div>`;
}

/** The skill picker a player sees. `mods` maps skill -> that rider's modifier; `targets` is from eligibleTargets. */
export function buildDialogHtml(state, pcId, menu, { mods = {}, targets = [], key }) {
  const used = new Set(state.used?.[pcId] ?? []);
  const strained = (state.drake?.[pcId] ?? 0) >= 2;
  const groups = [];
  for (const c of menu.choices) {
    let g = groups.find((x) => x.name === c.group);
    if (!g) { g = { name: c.group, desc: c.desc, items: [] }; groups.push(g); }
    g.items.push(c);
  }
  const showLines = menu.lines && menu.type !== "lane" && menu.type !== "battle";
  const lineHtml = showLines ? `<fieldset><legend>Line</legend>${Object.values(LINES).map((L, i) => {
    const dis = L.id === "risky" && strained;
    return `<label class="opt${dis ? " used" : ""}"><input type="radio" name="line" value="${L.id}" ${i === 1 ? "checked" : ""} ${dis ? "disabled" : ""}> `
      + `<b>${L.label}</b> · DC ${L.dc} · ${L.vp[0]} VP (crit ${L.vp[1]})${dis ? " <i>(a Strained drake can't go all-out)</i>" : ""}</label>`;
  }).join("")}<div class="note">Flair and lane choices set their own DC.</div></fieldset>` : "";

  const groupHtml = groups.map((g) => {
    const items = g.items.map((c) => {
      const isUsed = (menu.type !== "battle") && c.special !== "narrows" && used.has(c.skill);
      const mod = mods[c.skill];
      const label = c.special === "narrows" ? "Take the Narrows (pick three skills below)" : esc(SKILL_LABEL[c.skill]);
      const dc = c.line ? ` · ${LINES[c.line].label}, DC ${LINES[c.line].dc}` : "";
      const modText = mod === undefined ? "" : ` <b>${signed(mod)}</b>`;
      return `<label class="opt${isUsed ? " used" : ""}"><input type="radio" name="choice" value="${c.id}" ${isUsed ? "disabled" : ""}> `
        + `${isUsed ? `<s>${label}</s> <i>(already used this lap)</i>` : `${label}${modText}${dc}`}</label>`;
    }).join("");
    const narrows = g.items.some((c) => c.special === "narrows")
      ? `<div class="narrows">${["athletics", "acrobatics", "nature", "survival", "intimidation", "deception", "perception"].map((s) => `<label><input type="checkbox" name="narrows" value="${s}"> ${SKILL_LABEL[s]}${mods[s] === undefined ? "" : ` ${signed(mods[s])}`}</label>`).join(" ")}</div>` : "";
    return `<div class="grp"><div class="grp-title">${esc(g.name)}</div><div class="grp-desc">${esc(g.desc)}</div>${items}${narrows}</div>`;
  }).join("");

  const targetHtml = menu.choices.some((c) => c.target)
    ? `<fieldset><legend>Target (for rival effects)</legend><select name="target"><option value="">No target</option>${targets.map((t) => `<option value="${t.id}">${esc(t.name)} (${t.total} VP)</option>`).join("")}</select>${targets.length ? "" : '<div class="note">No rival is within 2 VP right now.</div>'}</fieldset>` : "";

  const favor = state.favor?.party ?? 0;
  const left = 2 - (state.favor?.spent ?? 0);
  const extras = `<fieldset><legend>Help</legend>
    <label>Bench help (circumstance) <select name="bench"><option value="0">None</option><option value="1">+1</option><option value="2">+2</option></select></label>
    <label class="spend"><input type="checkbox" name="spendFavor" ${favor < 1 || left < 1 ? "disabled" : ""}> Spend 1 Favor for +1 <i>(party has ${favor}; ${Math.max(0, left)} spend${left === 1 ? "" : "s"} left this lap)</i></label>
    <div class="note">The party's +2 is added automatically.${(state.drake?.[pcId] ?? 0) ? ` Your drake is ${DRAKE_STATES[state.drake[pcId]]}.` : ""}</div></fieldset>`;

  return `<form class="srt-dialog"><p class="intro">${esc(menu.intro)}</p>${lineHtml}<fieldset><legend>${menu.type === "battle" ? "Battle action" : "Approach"}</legend>${groupHtml}</fieldset>${targetHtml}${extras}</form>`;
}
