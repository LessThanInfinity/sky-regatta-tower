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
export function applyPcCheck(state, req, roll, options = {}) {
  const auto = options.autoVp !== false;      // false: the roll only suggests VP and the GM sets it
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
  const summary = `${choice.group} (${SKILL_LABEL[choice.skill] ?? choice.skill}), ${line}: ${total} ${DEGREE_LABEL[degree]} → ${auto ? "" : "suggests "}${signed(vp)} VP`;
  state.pending[pcId] = {
    lap: state.lap, key, choiceId: choice.id, group: choice.group, skill: choice.skill, lineId: lineId ?? null, dc,
    nat: roll.nat, mod: roll.mod, total, degree, vp: auto ? vp : 0, suggested: vp, auto, hold: ctx.hold, notes, summary, undo: change, target: ctx.target,
  };
  return { ok: true, pending: state.pending[pcId], parts: roll.parts ?? [] };
}

/** The Narrows: three checks, three different skills. rolls = [{ skill, nat, mod }, ...]. */
export function applyNarrows(state, req, rolls, options = {}) {
  const auto = options.autoVp !== false;
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
  const summary = `The Narrows: ${checks.map((c) => `${SKILL_LABEL[c.skill]} ${c.total} ${DEGREE_LABEL[c.degree]}`).join("; ")} → ${auto ? "" : "suggests "}${signed(vp)} VP`;
  state.pending[pcId] = { lap: state.lap, key: "B", choiceId: v.choice.id, group: v.choice.group, skill: "narrows", lineId: null, dc: NARROWS_DC, checks, vp: auto ? vp : 0, suggested: vp, auto, hold: 0, notes, summary, undo: change, degree: out ? "failure" : "success" };
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
const ENTRY_ACTION = { nature: "Command the drake", acrobatics: "Hold the line", athletics: "Muscle through", survival: "Read the wind", performance: "Flair", deception: "Psych out", intimidation: "Psych out" };
const BATTLE_ACTION = { athletics: "Bump", acrobatics: "Cut off", deception: "Distract", intimidation: "Distract", performance: "Distract", nature: "Draft" };
const CONTEST_ENTRY = new Set(["deception", "intimidation", "athletics"]);   // Psych out and Muscle through name a rival

/**
 * The rider an NPC is up against, going by the standings before the section: the nearest one ahead (the one they're
 * chasing), or the nearest chaser if they lead. Never a teammate. Ties for "nearest" are broken at random (`rand`).
 */
export function positionTarget(npc, before, rand = Math.random) {
  const rows = ROSTER.map((r) => ({ r, total: before?.[r.id] ?? 0 }));
  const me = rows.find((o) => o.r.id === npc.id);
  const others = rows.filter((o) => o.r.id !== npc.id && o.r.team !== npc.team);
  const pickNearest = (list, by) => {
    if (!list.length) return null;
    const best = list.reduce((m, o) => (by(o) < by(m) ? o : m), list[0]);
    const tied = list.filter((o) => by(o) === by(best));
    return tied[Math.floor(rand() * tied.length)].r.name;
  };
  const ahead = others.filter((o) => o.total > me.total);
  if (ahead.length) return pickNearest(ahead, (o) => o.total - me.total);
  return pickNearest(others, (o) => me.total - o.total);       // none ahead: the closest chaser
}

/**
 * Picks each NPC's skill, DC, action and target for the show: personality sets the line, the best modifier picks the skill.
 * ctx: { before: VP before the section, battleTargets: { npcId: { kind: "attack" | "draft", target } }, rand }.
 */
export function planNpcDice(npcs, lap, key, modFor, attackerIds = new Set(), ctx = {}) {
  return npcs.map((n) => {
    const lineId = n.tag === "aggressive" ? "risky" : n.tag === "cautious" ? "safe" : "standard";
    let opts = npcSkillOptions(lap, key, attackerIds.has(n.id));
    // A Draft is a Nature check (that's how it works for the PCs too), so show it as one.
    if (key === "C" && !attackerIds.has(n.id) && ctx.battleTargets?.[n.id]?.kind === "draft") opts = [["nature", null]];
    let best = null;
    for (const [skill, fixedLine] of opts) {
      const line = key === "C" ? null : (fixedLine ?? lineId);
      const dc = key === "C" ? BATTLE_DC : LINES[line].dc;
      const mod = modFor(n, skill);
      const margin = mod - dc;
      if (!best || margin > best.margin) best = { skill, line, fixedLine, dc, mod, margin };
    }
    let action = "", target = null;
    if (key === "A") {
      action = ENTRY_ACTION[best.skill] ?? "";
      if (CONTEST_ENTRY.has(best.skill)) target = positionTarget(n, ctx.before, ctx.rand);
    } else if (key === "B") {
      const c = sectionMenu(lap, "B").choices.find((x) => x.skill === best.skill && (best.fixedLine ? x.line === best.fixedLine : true));
      action = c?.group ?? "Obstacle";
    } else if (key === "C") {
      const bt = ctx.battleTargets?.[n.id];
      if (attackerIds.has(n.id)) { action = BATTLE_ACTION[best.skill] ?? "Attack"; target = bt?.target ?? null; }
      else if (bt?.kind === "draft") { action = "Draft"; target = bt.target; }
      else action = "Hold the line";
    } else action = "Sprint";
    return {
      id: n.id, name: n.name, skill: best.skill, mod: best.mod, dc: best.dc, action, target,
      lineLabel: best.line ? LINES[best.line].label : (attackerIds.has(n.id) ? "Attack" : "Hold the line"),
    };
  });
}

// ---------- HTML for chat cards and dialogs ----------
const sectionTitle = (lap, key) => `Lap ${lap} · ${key} · ${SECTION_NAME[key]}${key === "B" ? ` · ${OBSTACLE[lap]}` : ""}`;
const cardHead = (title, sub = "") => `<div class="srt-card-head"><span class="badge">SKY REGATTA</span><span class="title">${esc(title)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ""}</div>`;
const degPill = (degree) => `<span class="deg ${degree}">${DEGREE_LABEL[degree]}</span>`;
const vpLine = (vp, auto) => (auto ? `<b>${signed(vp)} VP</b>` : `<b>Suggested: ${signed(vp)} VP</b> <small>(the GM sets the VP)</small>`);

/** The six NPC d20s for the show: one tidy row per rider. */
export function buildNpcDiceHtml(lap, key, rows) {
  const lines = rows.map((r) => {
    const what = r.action ? `${esc(r.action)} (${esc(SKILL_LABEL[r.skill])} ${signed(r.mod)})` : `${esc(SKILL_LABEL[r.skill])} ${signed(r.mod)}`;
    const how = key === "C" ? `DC ${r.dc}` : `${esc(r.lineLabel)} · DC ${r.dc}`;
    return `<div class="frow"><div class="top"><span class="who">${esc(r.name)}</span>${degPill(r.degree)}</div>`
      + `<div class="det">${what} · ${how}</div>`
      + (r.target ? `<div class="tgt">&rarr; targets <b>${esc(r.target)}</b></div>` : "")
      + `<div class="calc">d20 <b>${r.nat}</b> ${signed(r.mod)} = <b>${r.total}</b></div></div>`;
  }).join("");
  return `<div class="srt-card srt-field">${cardHead("The field rolls", sectionTitle(lap, key))}${lines}</div>`;
}

/** The DCs for the section as three compact columns, with a button to roll. */
export function buildDcCardHtml(state, lap, key) {
  const menu = sectionMenu(lap, key);
  const col = (cls, name, sub, dc, vp) => `<div class="col ${cls}"><span class="nm">${esc(name)}</span><span class="sk">${esc(sub)}</span><span class="dc">DC ${dc}</span><span class="vp"><b>${vp[0]}</b> VP · crit <b>${vp[1]}</b></span></div>`;
  let cols = "", extra = "";
  if (menu.type === "lane") {
    cols = menu.choices.map((c) => col(c.line, c.group, SKILL_LABEL[c.skill], LINES[c.line].dc, LINES[c.line].vp)).join("");
  } else if (menu.type === "battle") {
    extra = `<div class="banner"><span class="dc">DC ${BATTLE_DC}</span><span>Bump · Cut off · Distract · Draft · Hold the line</span></div>`;
  } else {
    cols = Object.values(LINES).map((L) => col(L.id, L.label, L.id === "safe" ? "Steady" : L.id === "standard" ? "The usual" : "High stakes", L.dc, L.vp)).join("");
    if (menu.type === "hall") extra = `<div class="banner"><span class="dc">DC ${NARROWS_DC}</span><span>The Narrows: three checks, three different skills</span></div>`;
    if (lap === 4) extra = `<div class="banner"><span>Pick a patron: Qiu May's silk (Nature, Acrobatics) or Hida's steel (Athletics, Intimidation)</span></div>`;
  }
  const used = ["violet", "aji"].map((id) => {
    const list = (state.used?.[id] ?? []).map((sk) => `<span class="chip"><s>${SKILL_LABEL[sk]}</s></span>`).join("");
    return `<div class="urow"><span class="who">${riderName(id)}</span>${list || "<i>nothing used yet</i>"}</div>`;
  }).join("");
  return `<div class="srt-card srt-dc">${cardHead(sectionTitle(lap, key))}`
    + (cols ? `<div class="srt-dc-cols">${cols}</div>` : "") + extra
    + (menu.type === "battle" ? "" : `<div class="srt-card-foot"><span class="cap">Skills used this lap (no repeats)</span>${used}</div>`)
    + `<button type="button" class="srt-card-btn" data-srt-action="roll" data-lap="${lap}" data-key="${key}"><i class="fa-solid fa-dice-d20"></i> Roll my check</button></div>`;
}

/** A PC's roll: the big total, the degree, and what it does. */
export function buildPcRollHtml({ pcName, choice, lineId, dc, nat, parts, total, degree, vp, notes, auto = true }) {
  const bonus = parts.map((p) => `${signed(p.value)} ${esc(p.label)}`).join(", ");
  const how = lineId ? `${LINES[lineId].label} · DC ${dc}` : `DC ${dc}`;
  return `<div class="srt-card srt-roll">${cardHead(pcName, `${choice.group} (${SKILL_LABEL[choice.skill] ?? choice.skill})`)}`
    + `<div class="rollrow"><span class="big">${total}</span><span class="calc">d20 <b>${nat}</b> (${bonus})<br>${esc(how)}</span>${degPill(degree)}</div>`
    + `<div class="vpline">${vpLine(vp, auto)}${notes.length ? `<br><small>${notes.map(esc).join(" · ")}</small>` : ""}</div></div>`;
}

/** The Narrows: three checks. */
export function buildNarrowsHtml({ pcName, checks, vp, notes, auto = true }) {
  const rows = checks.map((c) => `<div class="nrow"><span class="who">${esc(SKILL_LABEL[c.skill])}</span><span class="calc">d20 <b>${c.nat}</b> ${signed(c.mod)} = <b>${c.total}</b></span>${degPill(c.degree)}</div>`).join("");
  return `<div class="srt-card srt-roll">${cardHead(pcName, `The Narrows (DC ${NARROWS_DC})`)}${rows}`
    + `<div class="vpline">${vpLine(vp, auto)}<br><small>${notes.map(esc).join(" · ")}</small></div></div>`;
}

/** What each line pays, for the three line cards. */
const LINE_CARD = {
  safe:     { tag: "Steady",        crit: "+2 VP", ok: "+1 VP", fail: "0",              critFail: "-1 VP" },
  standard: { tag: "The usual",     crit: "+3 VP", ok: "+2 VP", fail: "0",              critFail: "-1 VP" },
  risky:    { tag: "High stakes",   crit: "+4 VP", ok: "+3 VP", fail: "0, drake drops a rung", critFail: "-1 VP, drake drops a rung" },
};

/** The skill picker a player sees. `mods` maps skill -> that rider's modifier; `targets` is from eligibleTargets. */
export function buildDialogHtml(state, pcId, menu, { mods = {}, targets = [], key } = {}) {
  const used = new Set(state.used?.[pcId] ?? []);
  const strained = (state.drake?.[pcId] ?? 0) >= 2;
  const showLines = menu.lines && menu.type !== "lane" && menu.type !== "battle";

  // ---- step 1: the line, as three panels ----
  const lineHtml = showLines ? `<div class="srt-step"><span class="n">1</span> Choose your line</div><div class="srt-lines">${Object.values(LINES).map((L) => {
    const c = LINE_CARD[L.id];
    const dis = L.id === "risky" && strained;
    return `<label class="srt-pick srt-line ${L.id}${dis ? " off" : ""}"><input type="radio" name="line" value="${L.id}" ${L.id === "standard" ? "checked" : ""} ${dis ? "disabled" : ""}>`
      + `<span class="card"><span class="head"><b>${L.label}</b><span class="dc">DC ${L.dc}</span></span><span class="tag">${dis ? "A Strained drake can't go all-out" : c.tag}</span>`
      + `<span class="pay"><span><i>Critical success</i><b>${c.crit}</b></span><span><i>Success</i><b>${c.ok}</b></span><span><i>Failure</i><b>${c.fail}</b></span><span><i>Critical failure</i><b>${c.critFail}</b></span></span></span></label>`;
  }).join("")}</div>${menu.type === "hall" ? '<div class="srt-note">The Dip uses your line. The Narrows is three checks at DC 30 and ignores it.</div>' : '<div class="srt-note">Flair and fixed lanes set their own DC.</div>'}` : "";

  // ---- step 2: the approach, one row per skill: skill on the left, what it does on the right ----
  const rows = [];
  for (const c of menu.choices) {
    const isUsed = menu.type !== "battle" && c.special !== "narrows" && used.has(c.skill);
    const mod = mods[c.skill];
    const skillName = c.special === "narrows" ? "The Narrows" : SKILL_LABEL[c.skill];
    const modHtml = mod === undefined || c.special === "narrows" ? "" : `<span class="mod">${signed(mod)}</span>`;
    const pill = c.line ? `<span class="pill ${c.line}">${LINES[c.line].label} · DC ${LINES[c.line].dc}</span>` : "";
    const left = isUsed ? `<span class="skill"><s>${esc(skillName)}</s></span><span class="usedtag">used this lap</span>` : `<span class="skill">${esc(skillName)}${modHtml}</span>${pill}`;
    rows.push(`<label class="srt-pick srt-opt${isUsed ? " off" : ""}"><input type="radio" name="choice" value="${c.id}" ${isUsed ? "disabled" : ""}>`
      + `<span class="card"><span class="left">${left}</span><span class="right"><b>${esc(c.group)}</b><span>${esc(c.desc)}</span></span></span></label>`);
    if (c.special === "narrows") {
      rows.push(`<div class="srt-narrows"><span>Pick three different skills:</span>${["athletics", "acrobatics", "nature", "survival", "intimidation", "deception", "perception"].map((sk) => `<label class="chip"><input type="checkbox" name="narrows" value="${sk}"><span>${SKILL_LABEL[sk]}${mods[sk] === undefined ? "" : ` <b>${signed(mods[sk])}</b>`}</span></label>`).join("")}</div>`);
    }
  }
  const approachHtml = `<div class="srt-step"><span class="n">${showLines ? 2 : 1}</span> ${menu.type === "battle" ? "Choose your battle action" : menu.type === "lane" ? "Choose your lane" : "Choose your approach"}</div><div class="srt-opts">${rows.join("")}</div>`;

  // ---- target and help ----
  const needTarget = menu.choices.some((c) => c.target);
  const targetHtml = needTarget
    ? `<div class="srt-help"><label>Target <select name="target"><option value="">No target</option>${targets.map((t) => `<option value="${t.id}">${esc(t.name)} (${t.total} VP)</option>`).join("")}</select></label>${targets.length ? "" : '<span class="srt-note">No rival is within 2 VP right now.</span>'}</div>` : "";
  const favor = state.favor?.party ?? 0;
  const left = 2 - (state.favor?.spent ?? 0);
  const drakeNote = (state.drake?.[pcId] ?? 0) ? ` Your drake is ${DRAKE_STATES[state.drake[pcId]]}.` : "";
  const helpHtml = `<div class="srt-help">`
    + `<label>Bench help <select name="bench"><option value="0">None</option><option value="1">+1</option><option value="2">+2</option></select></label>`
    + `<label class="spend"><input type="checkbox" name="spendFavor" ${favor < 1 || left < 1 ? "disabled" : ""}> Spend 1 Favor for +1 <small>(party has ${favor}; ${Math.max(0, left)} left this lap)</small></label>`
    + `<span class="srt-note">The party's +2 is added automatically.${drakeNote}</span></div>`;

  return `<div class="srt-dialog"><p class="srt-intro">${esc(menu.intro)}</p>${lineHtml}${approachHtml}${targetHtml}${helpHtml}</div>`;
}
