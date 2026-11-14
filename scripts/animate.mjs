/**
 * Row sliding for the standings tower ("FLIP": First, Last, Invert, Play).
 * Before a redraw we remember where each rider's row is; after the redraw we move each row back to its old
 * spot with a transform and let it slide into place. It uses the Web Animations API, so the browser runs it on
 * the compositor: no timers, no per-frame JavaScript, and only rows that actually moved are touched.
 */

/**
 * Vertical position of every rider row, keyed by rider id, measured from the top of the list.
 * (Measuring from the list, not the page, means a header that grows a line doesn't make every row slide.)
 */
export function captureTops(root) {
  const tops = {};
  const origin = root?.querySelector?.(".srt-rows")?.getBoundingClientRect().top ?? 0;
  root?.querySelectorAll?.(".srt-row[data-id]").forEach((el) => { tops[el.dataset.id] = el.getBoundingClientRect().top - origin; });
  return tops;
}

/** Pure: which rows moved, and by how many pixels (positive = the row used to be lower, so it rose). */
export function computeSlides(prev, next, minPx = 1) {
  const out = [];
  for (const [id, top] of Object.entries(next ?? {})) {
    if (!prev || prev[id] === undefined) continue;      // a row we hadn't seen before just appears
    const dy = prev[id] - top;
    if (Math.abs(dy) >= minPx) out.push({ id, dy });
  }
  return out;
}

/** Slide the rows that moved. Returns how many rows were animated. */
export function playSlides(root, prevTops, { duration = 700 } = {}) {
  if (!root || !prevTops) return 0;
  const slides = computeSlides(prevTops, captureTops(root));
  for (const { id, dy } of slides) {
    const el = root.querySelector(`.srt-row[data-id="${id}"]`);
    if (!el?.animate) continue;
    el.style.zIndex = dy > 0 ? "2" : "1";               // rows that rise slide over the ones that drop
    const anim = el.animate(
      [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
      { duration, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
    );
    anim.onfinish = anim.oncancel = () => { el.style.zIndex = ""; };
  }
  return slides.length;
}
