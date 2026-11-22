/**
 * Where each drake sits in the race view. Pure JavaScript (no DOM), so it is unit tested.
 *
 * The view is a fixed portrait stage (VIEW.W by VIEW.H). The leader sits at the top and everyone else sits below, spaced by
 * a mix of rank (so the top three, the middle two and the last three always fill their thirds of the stage) and the real
 * VP gap (so a runaway leader looks like one). Drakes that would overlap are pushed sideways into free lanes.
 */
export const VIEW = {
  W: 340, H: 760,
  TOP: 64, BOTTOM: 74,
  BLEND: 0.4,        // 0 = space evenly by rank, 1 = pure VP gap
  GAP_FULL: 6,       // a gap of this many VP (or the widest gap, if bigger) spans the whole height
  MIN_STEP: 40,      // never closer than this vertically (ties stay in tower order)
  SEP_Y: 66, SEP_X: 124,   // two drakes closer than SEP_Y vertically must be SEP_X apart sideways
  SLOT_MARGIN: 74, SLOT_STEP: 12,
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * @param {Record<string, number>} vp   total VP by rider id
 * @param {string[]} ids                rider ids in roster order (breaks exact ties the same way every time)
 * @param {Record<string, {rank?: number, bx?: number}>} prev  the last plan, so lanes and tie order stay stable
 * @returns {{ cam: number, maxGap: number, riders: Record<string, {rank: number, ty: number, bx: number}> }}
 */
export function planRace(vp, ids, prev = {}) {
  const V = VIEW;
  const avail = V.H - V.TOP - V.BOTTOM;
  const total = (id) => vp[id] ?? 0;
  const lead = Math.max(...ids.map(total), 0);
  const maxGap = Math.max(...ids.map((id) => lead - total(id)), 0);
  const order = [...ids].sort((a, b) => total(b) - total(a) || (prev[a]?.rank ?? ids.indexOf(a)) - (prev[b]?.rank ?? ids.indexOf(b)) || ids.indexOf(a) - ids.indexOf(b));
  const full = Math.max(maxGap, V.GAP_FULL);
  const b = V.BLEND * Math.min(1, maxGap / full);          // a tight pack is spread evenly; a stretched one follows the real gaps more
  const steps = Math.max(ids.length - 1, 1);

  const riders = {};
  let prevTy = null;
  order.forEach((id, i) => {
    const raw = V.TOP + (1 - b) * (i / steps) * avail + b * ((lead - total(id)) / full) * avail;
    const ty = prevTy !== null && raw < prevTy + V.MIN_STEP ? prevTy + V.MIN_STEP : raw;
    riders[id] = { rank: i, ty, bx: V.W / 2 };
    prevTy = ty;
  });

  const slots = [];
  for (let x = V.SLOT_MARGIN; x <= V.W - V.SLOT_MARGIN; x += V.SLOT_STEP) slots.push(x);
  const placed = [];
  for (const id of order) {
    const me = riders[id];
    const home = prev[id]?.bx ?? V.W / 2;
    let best = slots[0], bestScore = Infinity;
    for (const x of slots) {
      let pen = 0;
      for (const p of placed) {
        const dy = Math.abs(p.ty - me.ty);
        if (dy < V.SEP_Y) { const dx = Math.abs(p.bx - x); if (dx < V.SEP_X) pen += (V.SEP_X - dx) * 6 + (V.SEP_Y - dy); }
      }
      const score = pen + Math.abs(x - home) * 0.35 + Math.abs(x - V.W / 2) * 0.06 + x * 1e-6;
      if (score < bestScore) { bestScore = score; best = x; }
    }
    me.bx = best;
    placed.push(me);
  }

  // very wide fields: shrink the drakes a little (positions already compress to fit)
  const cam = clamp(1 - (maxGap - 10) / 70, 0.7, 1);
  return { cam, maxGap, riders };
}
