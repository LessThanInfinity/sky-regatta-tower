/**
 * Sky Regatta rules engine. Pure JavaScript, no Foundry dependencies, so it can be unit tested in Node.
 * Rules come from sky-regatta-race-plan.md, section 7 (NPC riders).
 */

// ---------- CONFIG ----------
export const GAP_CAP = 6;          // tokens never sit more than this many squares behind the leader
export const MAX_NPC_ATTACKS = 2;  // at most this many NPCs attack per Battle
export const LAP_TABLE = { 1: 3, 2: 3, 3: 5, 4: 5, 5: 6, 6: 8 };
export const SECTIONS = ["A", "B", "C", "D"];
export const SECTION_NAME = { A: "Entry", B: "Obstacle", C: "Battle", D: "Sprint" };
/** 1 to 16: which section of the race this is (4 laps of 4). */
export const sectionNumber = (lap, key) => (lap - 1) * 4 + SECTIONS.indexOf(key) + 1;
export const OBSTACLE = { 1: "Bell Gate", 2: "Rising Hall", 3: "Cable Web", 4: "Sponsors' Rings" };

// rating: Ace +1, Steady 0, Rookie -1.  tag: aggressive | cautious | hothead | showboat | steady
export const ROSTER = [
  { id: "violet",   code: "VIO", name: "Violet",      team: "Party",             color: "#a855f7", pc: true,  actor: "Violet" , skills: { athletics: 23, acrobatics: 21, nature: 18, survival: 18, intimidation: 21, deception: 17, performance: 15, perception: 20, diplomacy: 17 } },
  { id: "aji",      code: "AJI", name: "Aji",         team: "Party",             color: "#a855f7", pc: true,  actor: "Aji Sakusen" , skills: { athletics: 24, acrobatics: 0, nature: 0, survival: 16, intimidation: 21, deception: 20, performance: 20, perception: 20, diplomacy: 22 } },
  { id: "viridian", code: "VIR", name: "Viridian",    team: "Scales of Destiny", color: "#22a559", rating: 1, tag: "hothead",    actor: "VIRIDIAN" , skills: { acrobatics: 27, nature: 27, athletics: 25, survival: 4, deception: 28, intimidation: 5, performance: 5, perception: 29, diplomacy: 30 } },
  { id: "ivory",    code: "IVO", name: "Ivory",       team: "Scales of Destiny", color: "#22a559", rating: 0, tag: "cautious",   actor: "IVORY" , skills: { athletics: 23, acrobatics: 4, nature: 4, survival: 4, deception: 5, intimidation: 26, performance: 5, perception: 28, diplomacy: 26 } },
  { id: "syu",      code: "SYU", name: "Syu Tak-nwa", team: "LightKeepers",      color: "#f5b301", rating: 1, tag: "aggressive", actor: "Syu Tak-nwa" , skills: { acrobatics: 26, athletics: 0, nature: 23, survival: 3, deception: 27, intimidation: 5, performance: 5, perception: 26, diplomacy: 5 } },
  { id: "ranto",    code: "RAN", name: "Ran-to",      team: "LightKeepers",      color: "#f5b301", rating: 0, tag: "aggressive", actor: "Ran-to" , skills: { athletics: 30, acrobatics: 24, intimidation: 24, survival: 23, nature: 1, deception: 2, performance: 2, perception: 20, diplomacy: 2 } },
  { id: "sarah",    code: "SAR", name: "Sarah",       team: "Flashpoint",        color: "#ff2e7e", rating: 0, tag: "showboat",   actor: "SARAH \"QUICKSHOT\"" , skills: { acrobatics: 30, athletics: 3, nature: 4, survival: 4, deception: 25, intimidation: 5, performance: 5, perception: 26, diplomacy: 5 } },
  { id: "dutch",    code: "DUT", name: "Dutch",       team: "Flashpoint",        color: "#ff2e7e", rating: 0, tag: "cautious",   actor: "DUTCH CARVER" , skills: { acrobatics: 28, athletics: 24, nature: 4, survival: 4, deception: 27, intimidation: 4, performance: 4, perception: 26, diplomacy: 24 } },
];
/** The two party members who stay on the bench (their skill numbers are fallbacks; the module reads the PF2e actor first). */
export const BENCH = [
  { id: "reta", name: "Reta", actor: "Reta kiri Osen", skills: { perception: 18, acrobatics: 22, athletics: 25, crafting: 17, diplomacy: 19, intimidation: 19, medicine: 0, nature: 0, performance: 23, society: 17, survival: 0, deception: 3 } },
  { id: "rowan", name: "Rowan", actor: "Rowan, the Unclaimed", skills: { perception: 22, acrobatics: 16, athletics: 0, crafting: 22, diplomacy: 23, intimidation: 5, medicine: 4, nature: 20, performance: 5, society: 19, survival: 4, deception: 21 } },
];
const NPCS = ROSTER.filter((r) => !r.pc);
const PCS = ROSTER.filter((r) => r.pc);
// ----------------------------

export const clone = (o) => JSON.parse(JSON.stringify(o));
const clamp16 = (n) => Math.min(6, Math.max(1, n));
export const signed = (n) => (n > 0 ? `+${n}` : `${n}`);
export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const shuffle = (a) => { const b = [...a]; for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };

export function freshState() {
  return {
    version: 1,
    lap: 1, sec: 0,
    vp: Object.fromEntries(ROSTER.map((r) => [r.id, 0])),
    delta: Object.fromEntries(ROSTER.map((r) => [r.id, 0])),
    lapRolls: {},
    sheltered: Object.fromEntries(ROSTER.map((r) => [r.id, false])),
    favor: { flashpoint: 0, party: 0, spent: 0 },   // party Favor can be spent for +1 (max 2 per lap)
    pending: {},      // each PC's roll for the section being played: { violet: { vp, skill, degree, ... } }
    pendingAdj: {},   // VP changes queued for NPCs by PC actions (for example a Bump), applied on the next roll
    used: { violet: [], aji: [] },     // skills each PC has used for a line roll this lap (no repeats)
    drake: { violet: 0, aji: 0 },      // drake condition: -1 Surging, 0 Fresh, 1 Winded, 2 Strained, 3 Spent
    influence: { qiu: 0, hida: 0 },    // Influence Points with the sponsors
    bonus: { violet: 0, aji: 0 },      // circumstance bonus carried to the next Obstacle roll
    last: null,       // { lap, key } of the section just resolved
    prevRank: null,   // rank of every rider before the last section (null when everyone was level)
    bench: { acts: {}, help: {}, pit: {}, pitLap: {} },   // bench actions this section, the help they gave, pit stops, and the lap of each rider's last stop
    history: [],
  };
}

/** How much a PC's total may change in one section (from the rules in the plan). */
export function sectionLimits(lap, key, opts = {}) {
  const base = baseLimits(lap, key);
  return opts.pit ? { min: base.min - 1, max: base.max } : base;      // a pit stop costs 1 VP on top
}
function baseLimits(lap, key) {
  switch (key) {
    case "A": return { min: -2, max: 4 };                    // best: Risky crit +4. -2 covers a crit fail plus a failed pit swap
    case "B": return lap === 2 ? { min: -1, max: 6 }         // Narrows: three checks, +2 each on a crit
                               : { min: -1, max: 4 };        // one lane roll, Risky crit +4
    case "C": return { min: -2, max: 2 };                    // Draft crit +2; two NPC hits -2
    default:  return { min: -1, max: 4 };                    // Sprint, Risky crit +4
  }
}
export const ADJ_LIMITS = { min: -3, max: 3 };               // GM adjustment to an NPC (for example a PC's Bump)

/** Fills in anything a state saved by an older version of the module doesn't have yet. */
export function normalizeState(state) {
  const f = freshState();
  for (const k of ["pending", "pendingAdj", "used", "drake", "influence", "bonus"]) state[k] ??= clone(f[k]);
  state.bench ??= clone(f.bench);
  for (const k of ["acts", "help", "pit", "pitLap"]) state.bench[k] ??= {};
  state.favor ??= {};
  for (const k of ["flashpoint", "party", "spent"]) state.favor[k] ??= 0;
  return state;
}

export const isFinished = (state) => state.lap > 4;
export const nextSection = (state) => (isFinished(state) ? null : { lap: state.lap, key: SECTIONS[state.sec], name: SECTION_NAME[SECTIONS[state.sec]] });

/** Deterministic ordering (ties keep roster order) so every client draws the same tower. */
export function standings(vp) {
  const rows = ROSTER.map((r, idx) => ({ ...r, idx, total: vp[r.id] ?? 0 }));
  rows.sort((a, b) => b.total - a.total || a.idx - b.idx);
  const lead = rows[0].total;
  let prev = null, rank = 0;
  rows.forEach((r, i) => {
    if (r.total !== prev) { rank = i + 1; prev = r.total; }
    r.rank = rank;
    r.gap = Math.min(GAP_CAP, lead - r.total);
  });
  return rows;
}

/**
 * Resolve ONE section. Mutates `state` and returns a report for the chat message.
 * @param state  race state
 * @param input  { violet, aji, violetSheltered, ajiSheltered, adj_<npcId> }  (PC totals default to the saved ones)
 * @param d6     async () => number 1..6
 * @param opts   { npcFouls: boolean }
 */
export async function resolveSection(state, input, d6, opts = {}) {
  normalizeState(state);
  const lap = state.lap;
  const key = SECTIONS[state.sec];
  state.history.push(clone({ ...state, history: undefined }));
  if (state.history.length > 10) state.history.shift();

  const before = clone(state.vp);
  const notes = Object.fromEntries(ROSTER.map((r) => [r.id, []]));
  const extra = [];

  // What each PC rolled this section (for the GM report) and any Hold the line they declared.
  const hold = Object.fromEntries(PCS.map((p) => [p.id, state.pending[p.id]?.hold ?? 0]));
  for (const p of PCS) {
    const pr = state.pending[p.id];
    if (pr) extra.push(`<b>${esc(p.name)}</b> rolled: ${esc(pr.summary ?? "")}`);
  }
  for (const a of Object.values(state.bench.acts)) extra.push(`<b>${esc(a.benchName)}</b> (bench): ${esc(a.summary)}`);
  for (const pc of PCS) {
    const v = input[pc.id];
    // No total typed in: use the PC's saved total plus whatever they rolled.
    state.vp[pc.id] = v === undefined || v === null || v === "" ? state.vp[pc.id] + (state.pending[pc.id]?.vp ?? 0) + (state.bench.pit[pc.id]?.cost ?? 0) : Number(v) || 0;
    const sh = input[`${pc.id}Sheltered`];
    if (sh !== undefined) state.sheltered[pc.id] = !!sh;
  }
  for (const n of NPCS) {
    const raw = input[`adj_${n.id}`];
    const adj = raw === undefined ? (state.pendingAdj[n.id] ?? 0) : Number(raw) || 0;
    if (adj) { state.vp[n.id] += adj; notes[n.id].push(`Adjustment ${signed(adj)} (a PC action or the GM)`); }
  }

  const leadTotal = Math.max(...ROSTER.map((r) => state.vp[r.id]));
  const leaders = ROSTER.filter((r) => state.vp[r.id] === leadTotal);

  if (key === "A") {
    for (const n of NPCS) {
      let mod = n.rating;
      let modText = n.rating ? ` ${signed(n.rating)} ${n.rating > 0 ? "Ace" : "Rookie"}` : "";
      if (n.tag === "hothead") {
        const total = state.vp[n.id];
        const hot = total < leadTotal ? 1 : (total === leadTotal && leaders.length === 1 ? -1 : 0);
        mod += hot;
        if (hot) modText += ` ${signed(hot)} Hothead (${hot > 0 ? "behind" : "ahead"})`;
      }
      // the NPC team's bench: with probability opts.npcBench each lap, +1 on the lap roll
      if ((opts.npcBench ?? 0) > 0 && (opts.rand ?? Math.random)() < opts.npcBench) { mod += 1; modText += " +1 bench"; }
      const raw = await d6();
      const eff = clamp16(raw + mod);
      const T = LAP_TABLE[eff];
      const base = Math.floor(T / 3), r = T % 3;
      const share = { a: base + (r >= 1 ? 1 : 0), b: base + (r >= 2 ? 1 : 0), d: base };
      state.lapRolls[n.id] = { raw, eff, T, ...share };
      state.vp[n.id] += share.a;
      notes[n.id].push(`Lap roll d6 ${raw}${modText} = ${eff} -> ${T} VP lap (A ${share.a} / B ${share.b} / D ${share.d})`);
      if (n.tag === "showboat") { state.favor.flashpoint += 1; notes[n.id].push("Showboat: +1 Favor for Flashpoint"); }
    }
    if (state.favor.flashpoint) extra.push(`Flashpoint Favor so far: ${state.favor.flashpoint}`);
  }

  if (key === "B") {
    for (const n of NPCS) {
      const lr = state.lapRolls[n.id] ?? { b: 0 };
      if (lap === 2 && n.tag === "cautious") {
        const strike = await d6();
        state.vp[n.id] += 2;
        state.sheltered[n.id] = strike !== 1;
        notes[n.id].push(`Narrows: flat +2 VP. Strike roll d6 ${strike} -> ${strike === 1 ? "STRIKE, loses shelter" : "sheltered in Battle"}`);
      } else {
        state.vp[n.id] += lr.b;
        notes[n.id].push(lap === 2 ? `Dip: +${lr.b} VP from the lap roll` : `${OBSTACLE[lap]}: +${lr.b} VP from the lap roll`);
      }
    }
  }

  if (key === "C") {
    const snap = ROSTER.map((r) => ({ ...r, total: state.vp[r.id], shelter: lap !== 4 && !!state.sheltered[r.id] }));
    const maxT = Math.max(...snap.map((r) => r.total));
    const pending = {};
    const pcHits = [];

    for (const n of NPCS.filter((x) => x.tag === "cautious")) {
      const me = snap.find((r) => r.id === n.id);
      const ahead = snap.filter((r) => r.id !== n.id && r.total > me.total && r.total - me.total <= 2).sort((a, b) => a.total - b.total);
      if (ahead.length) { pending[n.id] = (pending[n.id] || 0) + 1; notes[n.id].push(`Draft behind ${ahead[0].name}: +1 VP`); }
      else notes[n.id].push("Hold the line (no one to draft)");
    }

    const targetsFor = (me) => {
      const cand = snap.filter((r) => r.id !== me.id && r.team !== me.team && Math.abs(r.total - me.total) <= 2 && !r.shelter);   // never a teammate
      const ahead = shuffle(cand.filter((r) => r.total > me.total)).sort((a, b) => a.total - b.total);
      const level = shuffle(cand.filter((r) => r.total === me.total));
      const behind = shuffle(cand.filter((r) => r.total < me.total)).sort((a, b) => b.total - a.total);
      return [...ahead, ...level, ...behind];
    };
    const eligible = snap
      .filter((r) => !r.pc && (r.tag === "aggressive" || (r.tag === "hothead" && r.total < maxT)))
      .map((r) => ({ r, t: targetsFor(r) }));
    const withTarget = eligible.filter((e) => e.t.length);
    for (const e of eligible.filter((x) => !x.t.length)) notes[e.r.id].push("No one in range (within 2 VP): no attack");
    const ordered = shuffle(withTarget).sort((a, b) => (a.r.tag === "aggressive" ? 0 : 1) - (b.r.tag === "aggressive" ? 0 : 1));
    const attackers = ordered.slice(0, MAX_NPC_ATTACKS);
    for (const e of ordered.slice(MAX_NPC_ATTACKS)) notes[e.r.id].push("Held back (attack cap). Swap in if the story wants it.");
    for (const e of attackers) {
      const tgt = e.t[0];
      const roll = await d6();
      const hit = roll >= 4;
      const foul = !!opts.npcFouls && roll === 1;
      let line = `Attacks ${tgt.name}: d6 ${roll} -> ${hit ? "HIT" : "miss"}`;
      if (hit) {
        if (tgt.pc && hold[tgt.id]) {
          line += ` (${tgt.name} held the line: the attack is cancelled)`;
          if (hold[tgt.id] === 2) { pending[e.r.id] = (pending[e.r.id] || 0) - 1; line += `; their crit bumps ${e.r.name}: -1 VP`; }
          hold[tgt.id] = 0;                          // one attack cancelled per Hold the line
        } else if (tgt.pc) {
          pending[tgt.id] = (pending[tgt.id] || 0) - 1; pcHits.push(tgt); line += ` (${tgt.name} -1 VP)`;
        } else { pending[tgt.id] = (pending[tgt.id] || 0) - 1; notes[tgt.id].push(`Hit by ${e.r.name}: -1 VP`); line += " (-1 VP)"; }
      }
      if (foul) { pending[e.r.id] = (pending[e.r.id] || 0) - 1; line += ". FOUL: -1 VP, Hida's mercenaries flag them"; }
      notes[e.r.id].push(line);
    }
    for (const [id, d] of Object.entries(pending)) state.vp[id] += d;
    for (const p of pcHits) extra.push(`<b>${esc(p.name)}</b> was hit: -1 VP applied (they didn't Hold the line). If their Spotter cancels it (Perception DC 30), give the point back with the PC stepper.`);
    if (!attackers.length) extra.push("No NPC attacked this lap.");
    if (lap === 4) extra.push("Final Battle: no shelter.");
    for (const n of NPCS) if (!notes[n.id].length) notes[n.id].push("Holds position (no attack)");
    for (const r of ROSTER) state.sheltered[r.id] = false;
  }

  if (key === "D") {
    for (const n of NPCS) {
      const lr = state.lapRolls[n.id] ?? { d: 0 };
      state.vp[n.id] += lr.d;
      notes[n.id].push(`Sprint: +${lr.d} VP from the lap roll`);
    }
  }

  state.delta = Object.fromEntries(ROSTER.map((r) => [r.id, state.vp[r.id] - before[r.id]]));
  const levelBefore = new Set(Object.values(before)).size === 1;   // nobody had moved yet: no position changes to show
  state.prevRank = levelBefore ? null : Object.fromEntries(standings(before).map((r) => [r.id, r.rank]));
  state.last = { lap, key };
  const finished = lap === 4 && key === "D";
  state.pending = {};
  state.pendingAdj = {};
  state.bench.acts = {}; state.bench.help = {}; state.bench.pit = {};
  if (state.sec === 3) {
    state.sec = 0; state.lap += 1;
    state.used = { violet: [], aji: [] };      // the no-repeat rule is per lap
    state.favor.spent = 0;
    for (const id of Object.keys(state.drake)) if (state.drake[id] < 0) state.drake[id] = 0;     // Surging lasts until the next lap
  } else state.sec += 1;
  return { lap, key, before, notes, extra, finished };
}

/** Undo the last section. Returns the restored state, or null if there is nothing to undo. */
export function undo(state) {
  const prev = state.history.pop();
  if (!prev) return null;
  return { ...prev, history: state.history };
}

/** GM-only chat message: one list entry per rider, easy to read in a narrow sidebar. */
export function buildReport(state, rep) {
  const rows = standings(state.vp);
  const title = `Sky Regatta: Section ${sectionNumber(rep.lap, rep.key)}/16 · Lap ${rep.lap}, ${rep.key} (${SECTION_NAME[rep.key]}${rep.key === "B" ? ": " + OBSTACLE[rep.lap] : ""})`;
  const body = rows.map((r) => {
    const delta = r.total - rep.before[r.id];
    const gap = r.gap === 0 ? "LEADER" : `${r.gap}${r.gap === GAP_CAP ? "+" : ""} back`;
    const head = `<b>${r.rank}. ${esc(r.name)}${r.pc ? " (PC)" : ""}</b> &nbsp; ${signed(delta)} &rarr; <b>${r.total} VP</b> &nbsp; <i>${gap}</i>`;
    const detail = r.pc ? "" : rep.notes[r.id].map((n) => `<br><small>&bull; ${esc(n)}</small>`).join("");
    return `<p style="margin:0 0 6px 0">${head}${detail}</p>`;
  }).join("");
  let out = `<h4 style="margin:0 0 6px 0">${esc(title)}</h4>${body}`;
  if (rep.extra.length) out += `<ul>${rep.extra.map((e) => `<li>${e}</li>`).join("")}</ul>`;
  if (rep.finished) {
    out += `<p><b>RACE OVER.</b> Ties are broken by drake condition, then the highest roll in the final Sprint. Favor and awards are in the plan, section 8.</p>`;
  } else {
    const nx = nextSection(state);
    out += `<p>Next up: <b>Lap ${nx.lap}, Section ${nx.key} (${nx.name})</b></p>`;
    if (rep.key === "D") {
      const two = rows.slice(4).map((r) => r.name).join(", ");
      out += `<p><b>Pit after lap ${rep.lap}:</b> bottom half (2 actions): ${esc(two)}. Top half gets 1.</p>`;
    }
  }
  return out;
}
