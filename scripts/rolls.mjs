/**
 * Dice, DCs and PC checks for the Sky Regatta. Pure JavaScript (no Foundry), so it is unit tested.
 * Rules come from sky-regatta-race-plan.md (sections 2, 4 and 5).
 */
import { ROSTER, SECTION_NAME, OBSTACLE, normalizeState, signed, esc, sectionNumber } from "./engine.mjs";

export const PARTY_BONUS = 2;      // untyped bonus the party carries into every race roll
export const BATTLE_DC = 30;
export const NARROWS_DC = 30;
export const MAX_FAVOR_SPEND_PER_LAP = 2;

export const SKILL_LABEL = {
  acrobatics: "Acrobatics", athletics: "Athletics", nature: "Nature", survival: "Survival", performance: "Performance",
  deception: "Deception", intimidation: "Intimidation", perception: "Perception", diplomacy: "Diplomacy",
  crafting: "Crafting", medicine: "Medicine", society: "Society",
};
export const LINES = {
  safe:     { id: "safe",     label: "Hold pace", dc: 28, vp: [1, 2] },
  standard: { id: "standard", label: "Push",      dc: 30, vp: [2, 3] },
  risky:    { id: "risky",    label: "All-out",   dc: 32, vp: [3, 4] },
};
export const DRAKE_STATES = ["Fresh", "Winded", "Strained", "Spent"];
/** Rung -1 is Surging (one above Fresh). */
export const drakeName = (rung) => (rung < 0 ? "Surging" : DRAKE_STATES[rung] ?? "Fresh");
export const DRAKE_MIN = -1;
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
  mk("Flair", "performance", "Rile up the crowd! Success: +1 VP and 1 Favor. Crit: +2 VP and 2 Favor. No line needed.", { noLine: true, flatVp: [1, 2], fx: { success: { favor: 1 }, critSuccess: { favor: 2 } } }),
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
/** The sponsors watching the Sponsors' Rings. Add one by adding a line here; `favors` are the skills they like. */
export const SPONSORS = [
  { id: "qiu", name: "Lady Qiu May Shai", style: "Gentle with animals and drakes", favors: ["nature", "acrobatics"] },
  { id: "hida", name: "General Kaso Hida", style: "Disciplined, no politics", favors: ["athletics", "intimidation"] },
  { id: "roku", name: "Grandmaster Roku Ashida", style: "Finish with flair", favors: ["athletics", "performance"] },
  { id: "xhai", name: "Lady Xhai Zhia", style: "Theatrical, loves a show", favors: ["performance", "intimidation"] },
  { id: "dorik", name: "Foreman Dorik Ironvein", style: "Practical, mechanical", favors: ["athletics", "intimidation"] },
  { id: "unmar", name: "Lord Aldanar Unmar", style: "Exacting, easily offended", favors: ["intimidation", "deception"] },
  { id: "malaika", name: "Malaika Tao", style: "Administrator: useful, not flashy", favors: ["deception", "survival"] },
  { id: "anjali", name: "Matriarch Anjali Veshnaag", style: "Reverent, scorns showboating", favors: ["athletics", "nature"] },
  { id: "yudzuki", name: "Seer Yudzuki Amaya", style: "Honest signs, hates posturing", favors: ["survival", "nature"] },
  { id: "lien", name: "Broker Lien Hua", style: "Cunning, hidden angles", favors: ["deception", "survival"] },
];
const RING_SKILLS = ["athletics", "acrobatics", "nature", "survival", "intimidation", "deception", "performance"];
const RINGS = RING_SKILLS.map((sk) => mk("Sponsors' Rings", sk, "Thread the rings under your sponsor's eye. Crit failure: your drake drops a rung.", { sponsored: true, fx: { critFailure: { drake: 1 } } }));
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
  return { type: "rings", title, intro: "Pick a line, the sponsor you want to impress, and any skill you haven't used this lap.", lines, choices: RINGS };
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
  const help = state.bench?.help?.[pcId] ?? {};
  const rung = state.drake?.[pcId] ?? 0;
  const pen = help.ignoreDrake ? 0 : drakePenalty(rung);
  if (pen) parts.push({ label: `drake (${drakeName(rung)})`, value: pen });
  const carried = key === "B" ? (state.bonus?.[pcId] ?? 0) : 0;
  const surge = rung < 0 ? 1 : 0;
  const circ = Math.max(Number(req.bench) || 0, carried, help.bonus ?? 0, surge);     // circumstance bonuses don't stack: the best one counts
  if (circ) parts.push({ label: "circumstance", value: circ });
  if (req.burn) parts.push({ label: "Burn", value: 2 });
  if (req.spendFavor) parts.push({ label: "Favor", value: 1 });
  return { parts, total: parts.reduce((a2, p) => a2 + p.value, 0), usedCarried: carried > 0 && circ === carried };
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
  if (choice.sponsored && !SPONSORS.some((x) => x.id === req.sponsor)) return { ok: false, error: "Pick a sponsor." };
  let lineId = choice.line ?? (choice.noLine ? "standard" : req.lineId);
  if (needsLine(menu, choice) && !LINES[lineId]) return { ok: false, error: "Pick a line." };
  if (lineId === "risky" && (state.drake[pc.id] ?? 0) >= 2) return { ok: false, error: "A Strained drake can't take a Risky line." };
  if (req.burn) {
    if (choice.special === "narrows") return { ok: false, error: "You can't Burn the drake in the Narrows." };
    if ((state.drake[pc.id] ?? 0) > 0) return { ok: false, error: "Only a Fresh or Surging drake can be burned for the bonus." };
  }
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

  let vp = choice.battle ? 0 : choice.flatVp ? (degree === "critSuccess" ? choice.flatVp[1] : degree === "success" ? choice.flatVp[0] : 0) : lineVp(lineId, degree);
  if (lineId === "risky" && (degree === "failure" || degree === "critFailure")) ctx.drake = Math.max(ctx.drake, 1);
  applyEffect(state, pcId, choice.fx[degree], ctx, change, notes);
  let sponsorFavored = false;
  if (choice.sponsored) {
    const sp = SPONSORS.find((x) => x.id === req.sponsor);
    sponsorFavored = sp.favors.includes(choice.skill);
    notes.push(`Sponsor: ${sp.name}${sponsorFavored ? " ★ (a skill they favor)" : ""}`);
  }

  if (choice.needsBehind && ctx.self) {
    const tgt = ctx.target ? totalNow(state, ctx.target) : null;
    if (tgt === null || !(totalNow(state, pcId) < tgt)) { notes.push("Draft needs you to be behind your target: no gain."); ctx.self = 0; }
  }
  vp += ctx.self;

  // drake condition: at most one rung down per roll, or one up for a crit
  if (ctx.drake > 0) { const b = state.drake[pcId]; state.drake[pcId] = Math.min(3, b + 1); change.drake = state.drake[pcId] - b; notes.push(`Drake drops a rung (${drakeName(state.drake[pcId])})`); }
  else if (ctx.drake < 0) { const b = state.drake[pcId]; state.drake[pcId] = Math.max(DRAKE_MIN, b - 1); change.drake = state.drake[pcId] - b; if (change.drake) notes.push(`Drake climbs a rung (${drakeName(state.drake[pcId])})`); }
  if (req.burn) { const b0 = state.drake[pcId]; state.drake[pcId] = Math.min(3, b0 + 1); change.drake += state.drake[pcId] - b0; notes.push(`Burned the drake for +2 (now ${drakeName(state.drake[pcId])})`); }

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
    bench: Number(req.bench) || 0, spendFavor: !!req.spendFavor, parts: roll.parts ?? [],
    sponsor: req.sponsor ?? null, sponsorFavored, burn: !!req.burn,
    request: { choiceId: req.choiceId, lineId: req.lineId, target: req.target, sponsor: req.sponsor, bench: Number(req.bench) || 0, spendFavor: !!req.spendFavor, burn: !!req.burn },
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
  let cancelled = false;
  if (state.bench?.help?.[pcId]?.cancelStrike && strikes > 0) { strikes -= 1; cancelled = true; }
  const out = strikes >= 2;
  if (out) vp -= 1;
  const notes = [`${strikes} strike${strikes === 1 ? "" : "s"}${out ? ": thrown out of the Narrows (-1 VP, no shelter)" : ": still sheltered"}`];
  if (cancelled) notes.push("The Handler cancelled one strike.");
  const change = { favor: 0, drake: 0, adj: {}, influence: { qiu: 0, hida: 0 }, bonusSet: 0, usedSkill: null, bonusSpent: 0, favorSpent: 0, shelteredPrev: !!state.sheltered[pcId] };
  if (req.spendFavor) { state.favor.party -= 1; state.favor.spent += 1; change.favor -= 1; change.favorSpent = 1; }
  state.sheltered[pcId] = !out;
  const summary = `The Narrows: ${checks.map((c) => `${SKILL_LABEL[c.skill]} ${c.total} ${DEGREE_LABEL[c.degree]}`).join("; ")} → ${auto ? "" : "suggests "}${signed(vp)} VP`;
  state.pending[pcId] = { lap: state.lap, key: "B", choiceId: v.choice.id, group: v.choice.group, skill: "narrows", lineId: null, dc: NARROWS_DC, checks, vp: auto ? vp : 0, suggested: vp, auto, hold: 0, notes, summary, undo: change, degree: out ? "failure" : "success", bench: Number(req.bench) || 0, spendFavor: !!req.spendFavor, request: { choiceId: req.choiceId, bench: Number(req.bench) || 0, spendFavor: !!req.spendFavor, narrows: [...new Set(req.narrows ?? [])] } };
  return { ok: true, pending: state.pending[pcId], checks };
}

/** Takes a PC's pending roll back (a mistake, or a re-roll the GM allows). */
export function clearPcRoll(state, pcId) {
  const p = state.pending?.[pcId];
  if (!p) return false;
  const u = p.undo;
  state.favor.party = Math.max(0, state.favor.party - (u.favor ?? 0));
  state.favor.spent = Math.max(0, state.favor.spent - (u.favorSpent ?? 0));
  if (u.drake) state.drake[pcId] = Math.min(3, Math.max(DRAKE_MIN, state.drake[pcId] - u.drake));
  for (const [id, n] of Object.entries(u.adj ?? {})) { state.pendingAdj[id] = (state.pendingAdj[id] ?? 0) - n; if (!state.pendingAdj[id]) delete state.pendingAdj[id]; }
  for (const g of ["qiu", "hida"]) state.influence[g] = Math.max(0, state.influence[g] - (u.influence?.[g] ?? 0));
  if (u.bonusSet) state.bonus[pcId] = u.bonusPrev ?? 0;
  if (u.bonusSpent) state.bonus[pcId] = u.bonusSpent;
  if (u.usedSkill) { const i = state.used[pcId].lastIndexOf(u.usedSkill); if (i >= 0) state.used[pcId].splice(i, 1); }
  if (u.shelteredPrev !== undefined) state.sheltered[pcId] = u.shelteredPrev;
  delete state.pending[pcId];
  return true;
}

/**
 * Spend a Hero Point: reroll the d20 of a rider's finished roll and keep the new result (PF2e: you take the second roll).
 * A line roll rerolls its one die. The Narrows lets you pick which of its three dice (`which`, 0 to 2).
 * Everything the old roll did is undone and the new roll is applied in its place. One reroll per roll.
 */
export function rerollPcRoll(state, pcId, newNat, which = 0) {
  const pend = state.pending?.[pcId];
  if (!pend) return { ok: false, error: "There is no roll to reroll." };
  if (pend.heroUsed) return { ok: false, error: "A Hero Point has already been spent on this roll." };
  const isNarrows = pend.skill === "narrows";
  if (isNarrows && !(which >= 0 && which < (pend.checks?.length ?? 0))) return { ok: false, error: "Pick which of the three checks to reroll." };
  const snapshot = JSON.stringify(state);
  const oldNat = isNarrows ? pend.checks[which].nat : pend.nat;
  const oldTotal = isNarrows ? pend.checks[which].total : pend.total;
  const req = { pcId, lap: pend.lap, key: pend.key, ...pend.request };
  const auto = pend.auto;
  let rolls = null, roll = null;
  if (isNarrows) rolls = pend.checks.map((c, i) => ({ skill: c.skill, nat: i === which ? newNat : c.nat, mod: c.mod }));
  else roll = { nat: newNat, mod: pend.mod, parts: pend.parts ?? [] };
  const parts = pend.parts;
  clearPcRoll(state, pcId);
  const res = isNarrows ? applyNarrows(state, req, rolls, { autoVp: auto }) : applyPcCheck(state, req, roll, { autoVp: auto });
  if (!res.ok) {
    const back = JSON.parse(snapshot);
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, back);
    return res;
  }
  const np = state.pending[pcId];
  np.heroUsed = true;
  np.reroll = { which: isNarrows ? which : null, from: oldNat, fromTotal: oldTotal, to: newNat };
  np.summary += " · Hero Point reroll";
  return { ok: true, pending: np, checks: res.checks, parts: parts ?? [] };
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
export const sectionTitle = (lap, key) => `Section ${sectionNumber(lap, key)}/16 · Lap ${lap} ${key} · ${SECTION_NAME[key]}${key === "B" ? ` · ${OBSTACLE[lap]}` : ""}`;
export const cardHead = (title, sub = "") => `<div class="srt-card-head"><span class="badge">SKY REGATTA</span><span class="title">${esc(title)}</span>${sub ? `<span class="sub">${esc(sub)}</span>` : ""}</div>`;
export const degPill = (degree) => `<span class="deg ${degree}">${DEGREE_LABEL[degree]}</span>`;
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
    if (lap === 4) extra = `<div class="banner"><span>Pick one of the ${SPONSORS.length} sponsors to impress, and any skill you haven't used</span></div>`;
  }
  const used = ["violet", "aji"].map((id) => {
    const list = (state.used?.[id] ?? []).map((sk) => `<span class="chip"><s>${SKILL_LABEL[sk]}</s></span>`).join("");
    return `<div class="urow"><span class="who">${riderName(id)}</span>${list || "<i>nothing used yet</i>"}</div>`;
  }).join("");
  return `<div class="srt-card srt-dc">${cardHead(sectionTitle(lap, key))}`
    + (cols ? `<div class="srt-dc-cols">${cols}</div>` : "") + extra
    + (menu.type === "battle" ? "" : `<div class="srt-card-foot"><span class="cap">Skills used this lap (no repeats)</span>${used}</div>`)
    + `<button type="button" class="srt-card-btn" data-srt-action="roll" data-lap="${lap}" data-key="${key}"><i class="fa-solid fa-dice-d20"></i> Roll my check</button>`
    + `<button type="button" class="srt-card-btn srt-card-btn2" data-srt-action="bench"><i class="fa-solid fa-people-group"></i> Bench action</button></div>`;
}

/** A PC's roll: the big total, the degree, and what it does. */
export function buildPcRollHtml({ pcName, choice, lineId, dc, nat, parts, total, degree, vp, notes, auto = true, reroll = null }) {
  const bonus = parts.map((p) => `${signed(p.value)} ${esc(p.label)}`).join(", ");
  const how = lineId ? `${LINES[lineId].label} · DC ${dc}` : `DC ${dc}`;
  return `<div class="srt-card srt-roll">${cardHead(pcName, `${choice.group} (${SKILL_LABEL[choice.skill] ?? choice.skill})`)}`
    + `<div class="rollrow"><span class="big">${total}</span><span class="calc">d20 <b>${nat}</b> (${bonus})<br>${esc(how)}</span>${degPill(degree)}</div>`
    + (reroll ? `<div class="hero">&#9733; Hero Point reroll: <s>${reroll.from}</s> &rarr; <b>${reroll.to}</b></div>` : "")
    + `<div class="vpline">${vpLine(vp, auto)}${notes.length ? `<br><small>${notes.map(esc).join(" · ")}</small>` : ""}</div></div>`;
}

/** The Narrows: three checks. */
export function buildNarrowsHtml({ pcName, checks, vp, notes, auto = true, reroll = null }) {
  const rows = checks.map((c, i) => `<div class="nrow"><span class="who">${esc(SKILL_LABEL[c.skill])}${reroll && reroll.which === i ? " &#9733;" : ""}</span><span class="calc">d20 <b>${c.nat}</b> ${signed(c.mod)} = <b>${c.total}</b></span>${degPill(c.degree)}</div>`).join("");
  return `<div class="srt-card srt-roll">${cardHead(pcName, `The Narrows (DC ${NARROWS_DC})`)}${rows}`
    + (reroll ? `<div class="hero">&#9733; Hero Point reroll of ${esc(SKILL_LABEL[checks[reroll.which]?.skill] ?? "a check")}: <s>${reroll.from}</s> &rarr; <b>${reroll.to}</b></div>` : "")
    + `<div class="vpline">${vpLine(vp, auto)}<br><small>${notes.map(esc).join(" · ")}</small></div></div>`;
}

/** What each line pays, for the three line cards. */
const LINE_CARD = {
  safe:     { tag: "Steady",        crit: "+2 VP", ok: "+1 VP", fail: "0",              critFail: "-1 VP" },
  standard: { tag: "The usual",     crit: "+3 VP", ok: "+2 VP", fail: "0",              critFail: "-1 VP" },
  risky:    { tag: "High stakes",   crit: "+4 VP", ok: "+3 VP", fail: "0, drake drops a rung", critFail: "-1 VP, drake drops a rung" },
};

/** The skill picker a player sees. `mods` maps skill -> that rider's modifier; `targets` is from eligibleTargets. */
export function buildDialogHtml(state, pcId, menu, { mods = {}, targets = [], key, locked = null, heroLeft = 0 } = {}) {
  const L0 = locked;                                   // a finished roll: show what was picked, nothing can be changed
  const used = new Set(state.used?.[pcId] ?? []);
  const strained = (state.drake?.[pcId] ?? 0) >= 2;

  const stepHead = (n, text) => `<div class="srt-step"><span class="n">${n}</span> ${text}</div>`;

  // the three lines, as panels
  const linesPanel = () => `<div class="srt-lines">${Object.values(LINES).map((L) => {
    const c = LINE_CARD[L.id];
    const dis = L.id === "risky" && strained;
    return `<label class="srt-pick srt-line ${L.id}${dis || (L0 && L0.lineId !== L.id) ? " off" : ""}"><input type="radio" name="line" value="${L.id}" ${(L0 ? L0.lineId === L.id : L.id === "standard") ? "checked" : ""} ${dis || L0 ? "disabled" : ""}>`
      + `<span class="card"><span class="head"><b>${L.label}</b><span class="dc">DC ${L.dc}</span></span><span class="tag">${dis ? "A Strained drake can't go all-out" : c.tag}</span>`
      + `<span class="pay"><span><i>Critical success</i><b>${c.crit}</b></span><span><i>Success</i><b>${c.ok}</b></span><span><i>Failure</i><b>${c.fail}</b></span><span><i>Critical failure</i><b>${c.critFail}</b></span></span></span></label>`;
  }).join("")}</div>`;

  // one tile per skill: skill and modifier on top, what it does underneath
  const tile = (c) => {
    const isUsed = !L0 && menu.type !== "battle" && used.has(c.skill);
    const dim = isUsed || (L0 && L0.choiceId !== c.id);
    const mod = mods[c.skill];
    const modHtml = mod === undefined ? "" : `<span class="mod">${signed(mod)}</span>`;
    const pill = c.line ? `<span class="pill ${c.line}">${LINES[c.line].label} · DC ${LINES[c.line].dc}</span>` : "";
    const left = isUsed ? `<span class="skill"><s>${esc(SKILL_LABEL[c.skill])}</s></span><span class="usedtag">used this lap</span>` : `<span class="skill">${esc(SKILL_LABEL[c.skill])}${modHtml}<span class="star" title="A skill your sponsor favors">&#9733;</span></span>${pill}`;
    const favCls = c.sponsored ? SPONSORS.filter((x) => x.favors.includes(c.skill)).map((x) => ` fav-${x.id}`).join("") : "";
    return `<label class="srt-pick srt-opt${dim ? " off" : ""}${favCls}"><input type="radio" name="choice" value="${c.id}" ${L0 && L0.choiceId === c.id ? "checked" : ""} ${dim || L0 ? "disabled" : ""}>`
      + `<span class="card"><span class="left">${left}</span><span class="right"><b>${esc(c.group)}</b><span>${esc(c.desc)}</span></span></span></label>`;
  };
  const tiles = (list) => `<div class="srt-opts">${list.map(tile).join("")}</div>`;

  let body;
  if (menu.type === "hall") {
    // Rising Hall: pick a route first; the rest of the dialog follows the route
    const nar = menu.choices.find((c) => c.special === "narrows");
    const dip = menu.choices.filter((c) => c.special !== "narrows");
    const route = L0 ? (L0.skill === "narrows" ? "narrows" : "dip") : "dip";
    const routeCard = (id, name, tag, text) => `<label class="srt-pick srt-route-card${L0 && route !== id ? " off" : ""}"><input type="radio" name="route" value="${id}" ${route === id ? "checked" : ""} ${L0 ? "disabled" : ""}>`
      + `<span class="card ${id}"><span class="head"><b>${name}</b></span><span class="tag">${tag}</span><span class="txt">${text}</span></span></label>`;
    const chips = ["athletics", "acrobatics", "nature", "survival", "intimidation", "deception", "perception"].map((sk) => `<label class="chip"><input type="checkbox" name="narrows" value="${sk}" ${L0 ? "disabled" : ""} ${L0 && (L0.checks ?? []).some((x) => x.skill === sk) ? "checked" : ""}><span>${SKILL_LABEL[sk]}${mods[sk] === undefined ? "" : ` <b>${signed(mods[sk])}</b>`}</span></label>`).join("");
    body = stepHead(1, "Choose your route")
      + `<div class="srt-routes">${routeCard("narrows", "The Narrows", "Inside · sheltered", "Three checks at DC 30. You're safe from Battle attacks this lap.")}${routeCard("dip", "The Dip", "Outside · exposed", "One roll on a line of your choice. You enter Battle exposed.")}</div>`
      + `<div class="srt-route-panel srt-route-narrows">${stepHead(2, "Pick three different skills")}<div class="srt-narrows">${chips}</div>`
      + `<div class="srt-note">${esc(nar.desc)}</div><input type="hidden" name="narrowsChoice" value="${nar.id}"></div>`
      + `<div class="srt-route-panel srt-route-dip">${stepHead(2, "Choose your line")}${linesPanel()}${stepHead(3, "Choose your skill")}${tiles(dip)}</div>`;
  } else if (menu.type === "rings") {
    const chosen = L0 ? L0.sponsor : null;
    const card = (x) => `<label class="srt-pick srt-sponsor-card${L0 && chosen !== x.id ? " off" : ""}"><input type="radio" name="sponsor" value="${x.id}" ${chosen === x.id ? "checked" : ""} ${L0 ? "disabled" : ""}>`
      + `<span class="card"><span class="head"><b>${esc(x.name)}</b></span><span class="tag">${esc(x.style)}</span><span class="txt">Likes ${x.favors.map((f) => SKILL_LABEL[f]).join(", ")}</span></span></label>`;
    const starCss = SPONSORS.map((x) => `.srt-dialog:has(input[name="sponsor"][value="${x.id}"]:checked) .srt-opt.fav-${x.id} .star { display: inline; }`).join("\n");
    body = `<style>${starCss}</style>` + stepHead(1, "Choose your line") + linesPanel()
      + stepHead(2, "Choose your sponsor") + `<div class="srt-sponsors">${SPONSORS.map(card).join("")}</div>`
      + stepHead(3, "Choose your skill") + '<div class="srt-note">A &#9733; marks a skill your chosen sponsor likes. Any skill you haven\'t used this lap works.</div>' + tiles(menu.choices);
  } else {
    const showLines = menu.lines && menu.type !== "battle" && menu.type !== "lane";
    const word = menu.type === "battle" ? "Choose your battle action" : menu.type === "lane" ? "Choose your lane" : "Choose your approach";
    body = (showLines ? stepHead(1, "Choose your line") + linesPanel() + '<div class="srt-note">Flair and fixed lanes set their own DC.</div>' : "")
      + stepHead(showLines ? 2 : 1, word) + tiles(menu.choices);
  }

  // ---- target and help ----
  const needTarget = menu.choices.some((c) => c.target);
  const targetHtml = L0 ? (needTarget ? `<div class="srt-help"><span>Target: <b>${L0.target ? esc(riderName(L0.target)) : "none"}</b></span></div>` : "") : needTarget
    ? `<div class="srt-help"><label>Target <select name="target"><option value="">No target</option>${targets.map((t) => `<option value="${t.id}">${esc(t.name)} (${t.total} VP)</option>`).join("")}</select></label>${targets.length ? "" : '<span class="srt-note">No rival is within 2 VP right now.</span>'}</div>` : "";
  const favor = state.favor?.party ?? 0;
  const left = 2 - (state.favor?.spent ?? 0);
  const rung = state.drake?.[pcId] ?? 0;
  const help = state.bench?.help?.[pcId] ?? {};
  const helpBits = [];
  if (help.bonus) helpBits.push(`+${help.bonus} circumstance`);
  if (help.ignoreDrake) helpBits.push("drake penalty ignored");
  if (help.cancelStrike) helpBits.push("one Narrows strike cancelled");
  if (rung < 0) helpBits.push("+1 circumstance from your Surging drake");
  const benchLine = helpBits.length ? `<span class="srt-benchline">Bench help this section: <b>${esc(helpBits.join(", "))}</b></span>` : `<span class="srt-benchline none">No bench help this section yet.</span>`;
  const drakeNote = rung !== 0 ? ` Your drake is ${drakeName(rung)}.` : "";
  const canBurn = rung <= 0;
  const burnHtml = `<label class="spend burn"><input type="checkbox" name="burn" ${L0 ? (L0.burn ? "checked disabled" : "disabled") : (canBurn ? "" : "disabled")}> Burn the drake: +2 on this roll, but it drops a rung <small>(not in the Narrows; Fresh or Surging only)</small></label>`;
  const helpHtml = `<div class="srt-help">`
    + `${benchLine}`
    + `<label class="spend"><input type="checkbox" name="spendFavor" ${L0 ? (L0.spendFavor ? "checked disabled" : "disabled") : (favor < 1 || left < 1 ? "disabled" : "")}> Spend 1 Favor for +1 ${L0 ? "" : `<small>(party has ${favor}; ${Math.max(0, left)} left this lap)</small>`}</label>`
    + burnHtml
    + `<span class="srt-note">The party's +2 is added automatically.${drakeNote}</span></div>`;

  let resultHtml = "";
  if (L0) {
    const pcName = riderName(pcId);
    const card = L0.skill === "narrows"
      ? buildNarrowsHtml({ pcName, checks: L0.checks ?? [], vp: L0.suggested ?? 0, notes: L0.notes ?? [], auto: L0.auto, reroll: L0.reroll })
      : buildPcRollHtml({ pcName, choice: { group: L0.group, skill: L0.skill }, lineId: L0.lineId, dc: L0.dc, nat: L0.nat, parts: L0.parts ?? [], total: L0.total, degree: L0.degree, vp: L0.suggested ?? 0, notes: L0.notes ?? [], auto: L0.auto, reroll: L0.reroll });
    let hero = "";
    if (L0.heroUsed) hero = `<div class="srt-hero used">&#9733; You spent a Hero Point on this roll.</div>`;
    else if (heroLeft > 0) {
      const pickWhich = L0.skill === "narrows"
        ? `<div class="which">Reroll which check? ${(L0.checks ?? []).map((c, i) => `<label class="chip"><input type="radio" name="rerollWhich" value="${i}" ${i === 0 ? "checked" : ""}><span>${esc(SKILL_LABEL[c.skill])} ${c.total}</span></label>`).join("")}</div>`
        : `<div class="which">Rerolls your d20. You must keep the new result.</div>`;
      hero = `<div class="srt-hero">&#9733; <b>Hero Point:</b> you have ${heroLeft}. ${pickWhich}<small>Use the button below the dialog.</small></div>`;
    }
    resultHtml = `<div class="srt-locked"><div class="cap">Already rolled this section &mdash; your choices are locked</div>${card}${hero}</div>`;
  }
  return `<div class="srt-dialog">${resultHtml}<p class="srt-intro">${esc(menu.intro)}</p>${body}${targetHtml}${helpHtml}</div>`;
}

/** Reads the roll dialog's form into the request fields (the Narrows route has its own hidden choice). */
export function readRerollForm(fd) {
  return { which: Number(fd.get("rerollWhich") || 0) };
}

export function readDialogForm(fd) {
  const narrows = fd.get("route") === "narrows";
  return {
    choiceId: narrows ? fd.get("narrowsChoice") : fd.get("choice"),
    lineId: narrows ? undefined : (fd.get("line") || undefined),
    target: fd.get("target") || undefined,
    sponsor: fd.get("sponsor") || undefined,
    bench: Number(fd.get("bench") || 0),
    spendFavor: fd.get("spendFavor") === "on",
    burn: fd.get("burn") === "on",
    narrows: narrows ? fd.getAll("narrows") : [],
  };
}
