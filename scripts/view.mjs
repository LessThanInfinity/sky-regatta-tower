/**
 * View helpers shared by the Foundry window and the browser preview. Pure JavaScript.
 */
import {
  ROSTER, BENCH, GAP_CAP, SECTION_NAME, OBSTACLE, sectionNumber,
  standings, nextSection, isFinished, signed, sectionLimits, ADJ_LIMITS,
  normalizeState,
} from "./engine.mjs";
import { SKILL_LABEL, DEGREE_LABEL, drakeName } from "./rolls.mjs";
import { benchAction } from "./bench.mjs";

/** Everything the tower template needs. */
export function towerContext(state, { isGM = false, portraitFor = null, canRoll = false, canBench = false } = {}) {
  normalizeState(state);
  const rows = standings(state.vp).map((r) => {
    const d = state.delta[r.id] ?? 0;
    const prev = state.prevRank?.[r.id];
    const moved = prev ? prev - r.rank : 0;     // positive = gained places
    return {
      ...r,
      deltaText: d === 0 ? "" : signed(d),
      deltaClass: d > 0 ? "up" : d < 0 ? "down" : "flat",
      moveText: moved > 0 ? `▲${moved}` : moved < 0 ? `▼${-moved}` : "",
      moveClass: moved > 0 ? "up" : moved < 0 ? "down" : "",
      rowClass: moved > 0 ? "moved-up" : moved < 0 ? "moved-down" : "",
      gapText: r.gap === 0 ? "LEADER" : `${r.gap}${r.gap === GAP_CAP ? "+" : ""} back`,
      isLeader: r.gap === 0,
      portrait: portraitFor ? portraitFor(r) : null,
    };
  });

  const finished = isFinished(state);
  const nx = nextSection(state);
  const last = state.last;
  const pitOf = (id) => state.bench?.pit?.[id]?.cost ?? 0;
  const limOf = (id) => (nx ? sectionLimits(nx.lap, nx.key, { pit: pitOf(id) < 0 }) : null);
  const lim = nx ? sectionLimits(nx.lap, nx.key) : null;
  const limitText = lim ? `${signed(lim.min)} to ${signed(lim.max)}` : "";

  return {
    rows, finished,
    started: !!last,
    lapLabel: finished ? "FINISH" : `LAP ${Math.min(state.lap, 4)}/4`,
    subtitle: finished ? "Final standings"
      : `Section ${sectionNumber(nx.lap, nx.key)}/16 · ${nx.key}, ${nx.name}${nx.key === "B" ? ` · ${OBSTACLE[nx.lap]}` : ""}`,
    nextLabel: nx ? `Section ${sectionNumber(nx.lap, nx.key)}/16 · Lap ${nx.lap} ${nx.key}, ${nx.name}${nx.key === "B" ? ` (${OBSTACLE[nx.lap]})` : ""}` : "Race over",
    isGM,
    showShelter: state.lap === 2,
    limitText,
    pcs: ROSTER.filter((r) => r.pc).map((r) => {
      const pend = state.pending[r.id];
      const pit = pitOf(r.id);
      const gain = (pend?.vp ?? 0) + pit;      // a pit stop's cost is already in the stepper
      const lm = limOf(r.id);
      return {
        id: r.id, name: r.name,
        base: state.vp[r.id],                 // total before this section
        gain, newTotal: state.vp[r.id] + gain,
        min: lm ? lm.min : 0,                 // allowed change this section
        max: lm ? lm.max : 0,
        pit: pit < 0,
        sheltered: !!state.sheltered[r.id],
        rolledText: pend ? pend.summary : "",
        hasPending: !!pend,
        showSuggest: !!pend && pend.auto === false,
        suggested: pend?.suggested ?? 0,
        suggestedText: pend ? `${(pend.suggested ?? 0) > 0 ? "+" : ""}${pend.suggested ?? 0} VP` : "",
      };
    }),
    adjustable: ROSTER.filter((r) => !r.pc).map((r) => ({
      id: r.id, name: r.name, min: ADJ_LIMITS.min, max: ADJ_LIMITS.max, value: state.pendingAdj[r.id] ?? 0,
    })),
    adjOpen: Object.values(state.pendingAdj).some((v) => v),
    canRoll,
    canBench,
    benchWaiting: BENCH.filter((b) => !state.bench?.acts?.[b.id]).map((b) => b.name.split(/[ ,]/)[0]).join(" and "),
    benchActs: Object.values(state.bench?.acts ?? {}).map((a) => ({ id: a.benchId, who: a.benchName, text: `${benchAction(a.action).name}${a.rider ? ` for ${ROSTER.find((r) => r.id === a.rider)?.name}` : ""}`, degree: DEGREE_LABEL[a.degree], degreeClass: a.degree, notes: a.notes.join(" · ") })),
    // shown to everyone at the bottom of the tower
    riders: ROSTER.filter((r) => r.pc).map((r) => ({
      id: r.id, name: r.name,
      used: (state.used[r.id] ?? []).map((sk) => SKILL_LABEL[sk] ?? sk),
      noneUsed: !(state.used[r.id] ?? []).length,
      drake: drakeName(state.drake[r.id] ?? 0),
      drakeRung: state.drake[r.id] ?? 0,
      drakeClass: (state.drake[r.id] ?? 0) < 0 ? "dS" : `d${state.drake[r.id] ?? 0}`,
      pit: pitOf(r.id) < 0,
      benchHelp: (() => { const h = state.bench?.help?.[r.id]; if (!h) return ""; const bits = []; if (h.bonus) bits.push(`+${h.bonus}`); if (h.ignoreDrake) bits.push("calm drake"); if (h.cancelAttack) bits.push("attack called"); return bits.join(", "); })(),
      rolled: !!state.pending[r.id],
      rolledLabel: rolledLabel(state.pending[r.id]),
      rolledClass: state.pending[r.id]?.degree ?? "",
    })),
    status: {
      favor: state.favor.party ?? 0,
      favorSpent: state.favor.spent ?? 0,
      qiu: state.influence.qiu ?? 0,
      hida: state.influence.hida ?? 0,
    },
    showStatus: !finished,
  };
}

/** Returns an error message if a PC total or NPC adjustment is outside the allowed range, otherwise null. */
export function validateInput(state, input, unlocked = false) {
  if (unlocked) return null;
  const nx = nextSection(state);
  if (!nx) return null;
  for (const r of ROSTER.filter((x) => x.pc)) {
    const lim = sectionLimits(nx.lap, nx.key, { pit: (state.bench?.pit?.[r.id]?.cost ?? 0) < 0 });
    const v = input[r.id];
    if (v === undefined || v === null || v === "" || Number.isNaN(Number(v))) continue;
    const change = Number(v) - state.vp[r.id];
    if (change < lim.min || change > lim.max) {
      return `${r.name}: a change of ${signed(change)} is outside ${signed(lim.min)} to ${signed(lim.max)} for this section. Tick "Unlock limits" to override.`;
    }
  }
  for (const r of ROSTER.filter((x) => !x.pc)) {
    const v = Number(input[`adj_${r.id}`]) || 0;
    if (v < ADJ_LIMITS.min || v > ADJ_LIMITS.max) {
      return `${r.name}: an adjustment of ${signed(v)} is outside ${signed(ADJ_LIMITS.min)} to ${signed(ADJ_LIMITS.max)}. Tick "Unlock limits" to override.`;
    }
  }
  return null;
}

/** Readout next to a PC stepper: the new total, and whether the points being added are allowed. */
export function readoutFor(base, gain, min, max) {
  const g = Number(gain) || 0;
  return { total: base + g, ok: g >= min && g <= max };
}

/** Text for the "rolled" badge: the degree of success (or how the Narrows went). */
function rolledLabel(p) {
  if (!p) return "";
  if (p.skill === "narrows") return p.degree === "success" ? "Sheltered" : "Thrown out";
  return DEGREE_LABEL[p.degree] ?? "Rolled";
}
