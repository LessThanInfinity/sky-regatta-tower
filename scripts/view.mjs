/**
 * View helpers shared by the Foundry window and the browser preview. Pure JavaScript.
 */
import {
  ROSTER, GAP_CAP, SECTION_NAME, OBSTACLE,
  standings, nextSection, isFinished, signed, sectionLimits, ADJ_LIMITS,
  normalizeState,
} from "./engine.mjs";
import { SKILL_LABEL, DRAKE_STATES } from "./rolls.mjs";

/** Everything the tower template needs. */
export function towerContext(state, { isGM = false, portraitFor = null, canRoll = false } = {}) {
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
  const lim = nx ? sectionLimits(nx.lap, nx.key) : null;
  const limitText = lim ? `${signed(lim.min)} to ${signed(lim.max)}` : "";

  return {
    rows, finished,
    started: !!last,
    lapLabel: finished ? "FINISH" : `LAP ${Math.min(state.lap, 4)}/4`,
    subtitle: finished ? "Final standings"
      : last ? `After ${SECTION_NAME[last.key]}${last.key === "B" ? ` · ${OBSTACLE[last.lap]}` : ""}` : "On the grid",
    nextLabel: nx ? `Lap ${nx.lap}, ${nx.key} · ${nx.name}${nx.key === "B" ? ` (${OBSTACLE[nx.lap]})` : ""}` : "Race over",
    isGM,
    showShelter: state.lap === 2,
    limitText,
    pcs: ROSTER.filter((r) => r.pc).map((r) => {
      const pend = state.pending[r.id];
      const gain = pend?.vp ?? 0;
      return {
        id: r.id, name: r.name,
        base: state.vp[r.id],                 // total before this section
        gain, newTotal: state.vp[r.id] + gain,
        min: lim ? lim.min : 0,               // allowed change this section
        max: lim ? lim.max : 0,
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
    // shown to everyone at the bottom of the tower
    riders: ROSTER.filter((r) => r.pc).map((r) => ({
      id: r.id, name: r.name,
      used: (state.used[r.id] ?? []).map((sk) => SKILL_LABEL[sk] ?? sk),
      noneUsed: !(state.used[r.id] ?? []).length,
      drake: DRAKE_STATES[state.drake[r.id] ?? 0],
      drakeRung: state.drake[r.id] ?? 0,
      rolled: !!state.pending[r.id],
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
  const lim = sectionLimits(nx.lap, nx.key);
  for (const r of ROSTER.filter((x) => x.pc)) {
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
