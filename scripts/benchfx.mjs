/**
 * Bench visuals: turns what the bench has done this section into per-rider effects for the race view.
 * Pure, so every client works out the same thing from the shared state. Spotter only for now.
 *   good  = Spotter success       (flashing green, then a pulsing green aura)
 *   great = Spotter crit success  (brighter, faster green)
 *   bad   = Spotter crit failure  (red flash, then a dim red aura)
 * The aura clears once the rider has rolled their section.
 * Returns { riderId: { kind, tone, key } }. `key` changes whenever the act does, so the view can flash once per new act.
 */
export function benchAuras(state) {
  const out = {};
  for (const act of Object.values(state?.bench?.acts ?? {})) {
    if (act?.action !== "spotter" || !act.rider) continue;
    const tone = act.degree === "critSuccess" ? "great" : act.degree === "success" ? "good" : act.degree === "critFailure" ? "bad" : null;
    if (!tone) continue;
    if (state.pending?.[act.rider]) continue;      // the rider has rolled: the help is used up (or the miss is over)
    const prev = out[act.rider];
    const rank = { bad: 0, good: 1, great: 2 };
    if (prev && rank[prev.tone] >= rank[tone]) continue;
    out[act.rider] = { kind: "spotter", tone, key: `${act.benchId}:${act.lap}:${act.key}:${act.nat}:${act.total}` };
  }
  return out;
}
