/**
 * The bench: the two party members who aren't riding help from the pit wall. Pure JavaScript, unit tested.
 * Each bench member takes ONE action per section, rolls a skill against the action's DC, and the result is stored in
 * state.bench so the riders' rolls (and the next resolveSection) pick it up.
 */
import { ROSTER, BENCH, normalizeState, signed, esc } from "./engine.mjs";
import { degreeOf, SKILL_LABEL, DEGREE_LABEL, drakeName, DRAKE_MIN, PARTY_BONUS, RULES, outcomeHtml, cardHead, degPill, sectionTitle } from "./rolls.mjs";

export const PIT_COST = -1;                    // VP a rider pays to box

/** What a bench member can do. `before`: has to happen before the rider rolls. */
export const BENCH_ACTIONS = [
  { id: "spotter", name: "Spotter", skills: ["perception"], dc: 28, target: true, before: true, in: "ABD",
    desc: "Read the gaps for your rider. Success: +1 circumstance on their roll this section. Crit: +2 circumstance instead." },
  { id: "pit", name: "Pit crew", skills: ["nature", "medicine", "crafting"], dc: 30, target: true, in: "ABCD",
    desc: `Box your rider: they pay ${PIT_COST} VP. Success: the drake climbs a rung (up to Surging). Crit: the drake climbs two rungs. Crit failure: the drake drops a rung. Once per rider per lap.` },
  { id: "fix", name: "Fix it", skills: ["nature", "diplomacy"], dc: 30, target: true, before: true, in: "ABD",
    desc: "Calm the drake and settle your rider. Success: their drake's penalty is ignored this section, and one Narrows strike is cancelled. Crit: also, their last used skill can be used again this lap." },
  // Battle: the bench is on the ground, so it can only watch and shout
  { id: "call", name: "Call the attack", skills: ["perception"], dc: 28, target: true, in: "C",
    desc: "Shout a warning as a rival lines up your rider. Success: one NPC attack on them is cancelled. Crit: also +1 Favor. One cancel per attack; it doesn't stack with Hold the line." },
  { id: "crowd", name: "Work the crowd", skills: ["performance"], dc: 28, target: false, in: "C",
    desc: "Rile up the stands. Success: the party gains 1 Favor. Crit: 2 Favor. (No VP.)" },
  // switched on with the "extra bench actions" setting
  { id: "scout", name: "Scout", skills: ["society", "survival"], dc: 28, target: true, before: true, extra: true, in: "ABD",
    desc: "Study the course. Success: the GM tells you the best lane or line ahead. Crit: also +1 circumstance for your rider." },
];
/** The actions on offer under the current rules, and (if `key` is given) in that section. */
export const availableBenchActions = (key = null) => BENCH_ACTIONS.filter((a) => (!a.extra || RULES.benchExtras) && (!key || a.in.includes(key)));

const SECTIONS_KEY = (state) => ["A", "B", "C", "D"][state.sec];
export const benchEntry = (id) => BENCH.find((b) => b.id === id);
export const benchAction = (id) => BENCH_ACTIONS.find((a) => a.id === id);   // any action, even a switched-off one (old results keep their names)
const riderOf = (id) => ROSTER.find((r) => r.id === id && r.pc);

/** The bench member's modifier: skill plus the party's +2. */
export const benchMod = (skillMod) => skillMod + PARTY_BONUS;

/** Checks a bench request: { benchId, action, skill, rider }. Returns { ok, error } or { ok, member, action, skill, rider }. */
export function validateBenchRequest(state, req) {
  normalizeState(state);
  if (state.lap > 4) return { ok: false, error: "The race is over." };
  const member = benchEntry(req.benchId);
  if (!member) return { ok: false, error: "That bench member isn't on the team." };
  const key = ["A", "B", "C", "D"][state.sec];
  const action = availableBenchActions(key).find((a) => a.id === req.action);
  if (!action) return { ok: false, error: BENCH_ACTIONS.some((a) => a.id === req.action && a.in.includes(key)) ? "That action is switched off." : "Pick an action that works in this section." };
  const skill = req.skill || action.skills[0];
  if (!action.skills.includes(skill)) return { ok: false, error: `${action.name} can't use ${SKILL_LABEL[skill] ?? skill}.` };
  if (state.bench.acts[member.id]) return { ok: false, error: `${member.name} has already acted this section.` };
  let rider = null;
  if (action.target) {
    rider = riderOf(req.rider);
    if (!rider) return { ok: false, error: "Pick which rider you're helping." };
    if (action.before && state.pending[rider.id]) return { ok: false, error: `${rider.name} has already rolled this section, so help has to come first.` };
    if (action.id === "pit" && state.bench.pitLap[rider.id] === state.lap) return { ok: false, error: `${rider.name} has already boxed this lap.` };
  }
  return { ok: true, member, action, skill, rider };
}

/** Applies a finished bench roll { nat, mod, parts }. Returns { ok, act } where act is what is stored in state.bench.acts. */
export function applyBenchAction(state, req, roll) {
  const v = validateBenchRequest(state, req);
  if (!v.ok) return v;
  const { member, action, skill, rider } = v;
  const dc = action.dc;
  const total = roll.nat + roll.mod;
  const degree = degreeOf(total, dc, roll.nat);
  const win = degree === "success" || degree === "critSuccess";
  const crit = degree === "critSuccess";
  const notes = [];
  const change = { rider: rider?.id ?? null, favor: 0, drake: 0, helpPrev: undefined, pitPrev: undefined, pitLapPrev: undefined, usedRestored: [] };
  const key = ["A", "B", "C", "D"][state.sec];
  const help = () => {
    if (change.helpPrev === undefined) change.helpPrev = state.bench.help[rider.id] ? { ...state.bench.help[rider.id] } : null;
    return (state.bench.help[rider.id] ??= {});
  };

  if (action.id === "spotter") {
    const bonus = crit ? 2 : win ? 1 : 0;
    if (bonus) { const h = help(); h.bonus = Math.max(h.bonus ?? 0, bonus); notes.push(`${rider.name} gets +${bonus} circumstance on their roll this section`); }
    else notes.push("Nothing useful spotted.");
  } else if (action.id === "call") {
    if (win) {
      const h = help(); h.cancelAttack = true;
      notes.push(`One NPC attack on ${rider.name} is cancelled`);
      if (crit) { state.favor.party += 1; change.favor = 1; notes.push("+1 party Favor"); }
    } else notes.push("The warning comes too late.");
  } else if (action.id === "fix") {
    if (win) {
      const h = help(); h.ignoreDrake = true; h.cancelStrike = true;
      notes.push(`${rider.name}'s drake penalty is ignored this section; one Narrows strike would be cancelled`);
      if (crit) {
        const used = state.used[rider.id] ?? [];
        if (used.length) { const sk = used.pop(); change.usedRestored.unshift(sk); notes.push(`${rider.name} can use ${SKILL_LABEL[sk] ?? sk} again this lap`); }
      }
    } else notes.push("The drake stays jumpy.");
  } else if (action.id === "pit") {
    change.pitPrev = state.bench.pit[rider.id] ? { ...state.bench.pit[rider.id] } : null;
    change.pitLapPrev = state.bench.pitLap[rider.id];
    state.bench.pit[rider.id] = { lap: state.lap, key, cost: PIT_COST };
    state.bench.pitLap[rider.id] = state.lap;
    const before = state.drake[rider.id] ?? 0;
    const delta = crit ? -2 : win ? -1 : degree === "critFailure" ? 1 : 0;
    state.drake[rider.id] = Math.min(3, Math.max(DRAKE_MIN, before + delta));
    change.drake = state.drake[rider.id] - before;
    notes.push(`${rider.name} boxes: ${PIT_COST} VP`);
    notes.push(change.drake < 0 ? `Drake climbs to ${drakeName(state.drake[rider.id])}` : change.drake > 0 ? `Bad stop: drake drops to ${drakeName(state.drake[rider.id])}` : (before <= DRAKE_MIN && win ? "Drake is already Surging" : "The swap didn't help the drake"));
  } else if (action.id === "scout") {
    if (win) {
      notes.push("The GM tells the scout the best lane or line ahead");
      if (crit) { const h = help(); h.bonus = Math.max(h.bonus ?? 0, 1); notes.push(`${rider.name} gets +1 circumstance this section`); }
    } else notes.push("The course stays a blur.");
  } else if (action.id === "crowd") {
    const n = crit ? 2 : win ? 1 : 0;
    if (n) { state.favor.party += n; change.favor = n; notes.push(`+${n} party Favor`); } else notes.push("The stands stay quiet.");
  }

  const summary = `${action.name}${rider ? ` for ${rider.name}` : ""} (${SKILL_LABEL[skill]}): ${total} ${DEGREE_LABEL[degree]}. ${notes.join("; ")}`;
  const act = {
    lap: state.lap, key, benchId: member.id, benchName: member.name, action: action.id, skill, rider: rider?.id ?? null,
    dc, nat: roll.nat, mod: roll.mod, parts: roll.parts ?? [], total, degree, notes, summary, undo: change,
  };
  state.bench.acts[member.id] = act;
  return { ok: true, act };
}

/** Takes a bench member's action back (a mistake, or a re-roll the GM allows). */
export function clearBenchAct(state, benchId) {
  normalizeState(state);
  const act = state.bench.acts[benchId];
  if (!act) return false;
  const u = act.undo;
  if (u.rider) {
    if (u.helpPrev !== undefined) { if (u.helpPrev) state.bench.help[u.rider] = u.helpPrev; else delete state.bench.help[u.rider]; }
    if (act.action === "pit") {
      if (u.pitPrev) state.bench.pit[u.rider] = u.pitPrev; else delete state.bench.pit[u.rider];
      if (u.pitLapPrev === undefined) delete state.bench.pitLap[u.rider]; else state.bench.pitLap[u.rider] = u.pitLapPrev;
    }
    if (u.drake) state.drake[u.rider] = Math.min(3, Math.max(DRAKE_MIN, state.drake[u.rider] - u.drake));
    if (u.usedRestored.length) (state.used[u.rider] ??= []).push(...u.usedRestored);
  }
  if (u.favor) state.favor.party = Math.max(0, state.favor.party - u.favor);
  delete state.bench.acts[benchId];
  return true;
}

// ---------- HTML ----------
/** The GM's chat card for a bench roll. */
export function buildBenchCardHtml(act, lap = act.lap, key = act.key) {
  const action = benchAction(act.action);
  const rider = act.rider ? riderOf(act.rider)?.name : null;
  const bonus = (act.parts ?? []).map((p) => `${signed(p.value)} ${esc(p.label)}`).join(", ");
  return `<div class="srt-card srt-roll">${cardHead(`${act.benchName}: ${action.name}${rider ? ` for ${rider}` : ""}`, sectionTitle(lap, key))}`
    + `<div class="rollrow"><span class="big">${act.total}</span><span class="calc">d20 <b>${act.nat}</b> (${bonus || signed(act.mod)})<br>${esc(SKILL_LABEL[act.skill])} · DC ${act.dc}</span>${degPill(act.degree)}</div>`
    + `<div class="vpline"><small>${act.notes.map(esc).join(" · ")}</small></div></div>`;
}

/** The bench member's dialog. `mods`: skill -> that member's modifier. `locked`: the act already made this section, if any. */
export function buildBenchDialogHtml(state, benchId, { mods = {}, locked = null } = {}) {
  normalizeState(state);
  const member = benchEntry(benchId);
  const picked = locked?.action ?? availableBenchActions(SECTIONS_KEY(state))[0]?.id;
  const tile = (a) => {
    const dim = locked && locked.action !== a.id;
    const skills = a.skills.map((s) => `${SKILL_LABEL[s]}${mods[s] === undefined ? "" : ` ${signed(benchMod(mods[s]))}`}`).join(" / ");
    return `<label class="srt-pick srt-opt${dim ? " off" : ""}"><input type="radio" name="action" value="${a.id}" ${picked === a.id ? "checked" : ""} ${locked ? "disabled" : ""}>`
      + `<span class="card"><span class="left"><span class="skill">${esc(a.name)}</span><span class="pill standard">DC ${a.dc}</span></span>`
      + `<span class="right"><b>${esc(skills)}</b>${outcomeHtml(a.desc)}</span></span></label>`;
  };
  const riderCard = (r) => {
    const rung = state.drake[r.id] ?? 0;
    const tags = [`Drake ${drakeName(rung)}`];
    if (state.bench.pitLap[r.id] === state.lap) tags.push("boxed this lap");
    if (state.pending[r.id]) tags.push("already rolled");
    const chosen = locked ? locked.rider === r.id : r.id === "violet";
    return `<label class="srt-pick srt-sponsor-card${locked && !chosen ? " off" : ""}"><input type="radio" name="rider" value="${r.id}" ${chosen ? "checked" : ""} ${locked ? "disabled" : ""}>`
      + `<span class="card"><span class="head"><b>${esc(r.name)}</b></span><span class="tag">${esc(tags.join(" · "))}</span></span></label>`;
  };
  const skillSets = BENCH_ACTIONS.filter((a) => a.skills.length > 1).map((a) =>
    `<div class="srt-skillset srt-skillset-${a.id}"><span>Which skill?</span>${a.skills.map((s, i) => `<label class="chip"><input type="radio" name="skill_${a.id}" value="${s}" ${(locked ? locked.skill === s : i === 0) ? "checked" : ""} ${locked ? "disabled" : ""}><span>${SKILL_LABEL[s]}${mods[s] === undefined ? "" : ` <b>${signed(benchMod(mods[s]))}</b>`}</span></label>`).join("")}</div>`).join("");
  const css = BENCH_ACTIONS.map((a) => `.srt-bench:has(input[name="action"][value="${a.id}"]:checked) .srt-skillset-${a.id} { display: flex; }`
    + (a.target ? "" : `\n.srt-bench:has(input[name="action"][value="${a.id}"]:checked) .srt-bench-riders { display: none; }`)).join("\n");
  const done = locked ? `<div class="srt-locked"><div class="cap">${esc(member.name)} has already acted this section</div>${buildBenchCardHtml(locked)}</div>` : "";
  const step = (n, t) => `<div class="srt-step"><span class="n">${n}</span> ${t}</div>`;
  return `<div class="srt-dialog srt-bench"><style>${css}</style>${done}<p class="srt-intro">${esc(member.name)} helps from the pit wall. One action per section.</p>`
    + step(1, "Choose your action") + `<div class="srt-opts">${availableBenchActions(SECTIONS_KEY(state)).map(tile).join("")}</div>`
    + `<div class="srt-bench-riders">${step(2, "Which rider?")}<div class="srt-sponsors srt-two">${ROSTER.filter((r) => r.pc).map(riderCard).join("")}</div></div>`
    + skillSets + `<div class="srt-note">Your roll adds the party's +2. In A, B and D help has to come before the rider rolls (except the Pit crew). In Battle, act before the GM rolls the section.</div></div>`;
}

export function readBenchForm(fd) {
  const action = fd.get("action") || undefined;
  return { action, rider: fd.get("rider") || undefined, skill: (action && fd.get(`skill_${action}`)) || undefined };
}
