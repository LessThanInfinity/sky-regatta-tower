/**
 * Artwork for the race view, as SVG strings. Pure JavaScript (no DOM).
 * The wyvern is drawn once as separate parts (two wings, tail, body, head) so the view can animate it with transforms only:
 * the wings fold and rotate at the shoulder, the tail sways, the whole drake banks. Colors come from the CSS variables
 * --c (body, bones) and --m (wing membrane), so each rider's drake has its own look.
 */

// ---- the wyvern (top down, head up). Wings sweep forward of the head, angular, with a notched trailing edge. ----
const MEMB = "M-7,-14 L-28,-48 L-52,-64 L-100,-80 L-165,-90 L-146,-60 L-148,-28 L-123,-21 L-114,-2 L-89,-3 L-74,14 L-40,4 L-9,12 Z";
const FING = ["M-52,-64 L-165,-90", "M-52,-64 L-148,-28", "M-52,-64 L-114,-2", "M-52,-64 L-74,14"];
const VEINS = "M-100,-76 L-135,-56 M-80,-72 L-120,-34 M-64,-58 L-96,-18 M-130,-50 L-112,-24 M-98,-22 L-90,-8 M-46,-44 L-52,-14 M-150,-60 L-132,-52";
const TAIL = "M-5,14 C-4,38 -3,64 -1.6,94 L-2.6,116 L-.5,98 L0,96 L.5,98 L2.6,116 L1.6,94 C3,64 4,38 5,14 Z";
const TORSO = "M0,-26 C7,-24 9,-12 7,2 C6,12 3,20 0,28 C-3,20 -6,12 -7,2 C-9,-12 -7,-24 0,-26 Z";
const NECK = "M-3,-24 C-3,-36 -2.5,-44 -1.6,-50 L1.6,-50 C2.5,-44 3,-36 3,-24 Z";
const HEAD = "M-4,-50 L-2.6,-58 L0,-64 L2.6,-58 L4,-50 C1.6,-48 -1.6,-48 -4,-50 Z";

/** Shared gradients and patterns. Include once in the view (ids are prefixed so they can't clash with Foundry's). */
export const DEFS_SVG = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <pattern id="srt-scales" width="7" height="6" patternUnits="userSpaceOnUse"><path d="M0 5 Q3.5 0 7 5" fill="none" stroke="rgba(0,0,0,.34)" stroke-width=".8"/></pattern>
  <linearGradient id="srt-bodyShade" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset=".35" stop-color="#fff" stop-opacity=".14"/><stop offset=".65" stop-color="#fff" stop-opacity=".14"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></linearGradient>
  <linearGradient id="srt-membTone" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".32"/><stop offset=".5" stop-color="#000" stop-opacity=".05"/><stop offset="1" stop-color="#ffd9b0" stop-opacity=".28"/></linearGradient>
  <linearGradient id="srt-membWarm" x1="1" x2="0" y1="0" y2="0"><stop offset="0" stop-color="#000" stop-opacity=".45"/><stop offset=".35" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".25"/></linearGradient>
</defs></svg>`;

/** One drake. The wing groups carry the class "wing" (animated), the tail "tail"; the left and right wings are "wl" and "wr". */
export function wyvernSvg() {
  const wing = `<g class="wing">
    <path d="${MEMB}" fill="var(--m)"/><path d="${MEMB}" fill="url(#srt-membTone)"/><path d="${MEMB}" fill="url(#srt-membWarm)"/>
    <path d="${VEINS}" stroke="rgba(0,0,0,.28)" stroke-width=".7" fill="none"/>
    <g stroke="rgba(10,10,14,.62)" stroke-width="1.5" fill="none">${FING.map((d) => `<path d="${d}"/>`).join("")}</g>
    <path d="M-7,-14 L-28,-48 L-52,-64" fill="none" stroke="var(--c)" stroke-width="4.4" stroke-linejoin="miter"/>
    <path d="M-52,-64 L-100,-80 L-165,-90" fill="none" stroke="var(--c)" stroke-width="2.6" stroke-linejoin="miter"/>
    <path d="M-52,-64 L-59,-77 L-70,-82" stroke="#cfc8b4" stroke-width="2.2" fill="none" stroke-linejoin="miter"/>
    <path d="M-165,-90 L-171,-91 M-148,-28 L-151,-23 M-114,-2 L-116,3 M-74,14 L-75,19" stroke="rgba(0,0,0,.6)" stroke-width="1.6"/>
  </g>`;
  const skin = (d) => `<path d="${d}" fill="var(--c)"/><path d="${d}" fill="url(#srt-scales)"/><path d="${d}" fill="url(#srt-bodyShade)"/>`;
  return `<svg viewBox="-172 -92 344 212" width="144" height="89" style="overflow:visible">
    <g class="tail">${skin(TAIL)}</g>
    <g class="wl">${wing}</g><g transform="scale(-1 1)" class="wr">${wing}</g>
    ${skin(TORSO)}
    <path d="M0,-52 L0,96" stroke="rgba(0,0,0,.4)" stroke-width="1.4" stroke-dasharray="1.6 2.2"/>
    ${skin(NECK)}${skin(HEAD)}
    <path d="M-3,-53 L-9,-48 L-3,-50 Z M3,-53 L9,-48 L3,-50 Z" fill="#cfc8b4"/>
  </svg>`;
}

// ---- the world below: terrain, cloud layers, and the rocks the drakes steer around (all decoration) ----
/** Small seeded random numbers, so every player sees the same land. */
export function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export function groundTileSvg(W, TILE, rand = seeded(1)) {
  const rnd = (a, b) => a + rand() * (b - a);
  const pal = ["#46583a", "#566a3d", "#75763f", "#665837", "#3d5035", "#7d7048", "#34462f", "#59502f"];
  let s = `<svg width="${W}" height="${TILE}" viewBox="0 0 ${W} ${TILE}"><rect width="${W}" height="${TILE}" fill="#3f5236"/>`;
  for (let i = 0; i < 70; i++) {
    const w = rnd(40, 130), h = rnd(30, 100), x = rnd(-20, W), y = rnd(30, TILE - 120), r = rnd(-14, 14);
    s += `<g transform="rotate(${r.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)})"><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${pal[i % pal.length]}" stroke="rgba(0,0,0,.18)"/>`;
    for (let k = 1; k < 5; k++) s += `<line x1="${x.toFixed(1)}" x2="${(x + w).toFixed(1)}" y1="${(y + k * h / 5).toFixed(1)}" y2="${(y + k * h / 5).toFixed(1)}" stroke="rgba(0,0,0,.10)"/>`;
    s += "</g>";
  }
  let d = "";
  for (let y = 0; y <= TILE; y += 20) d += `${y ? " L" : "M"}${(W / 2 + 80 * Math.sin(y / TILE * Math.PI * 2) + 28 * Math.sin(y / TILE * Math.PI * 6)).toFixed(1)},${y}`;
  s += `<path d="${d}" stroke="#2f5a6c" stroke-width="30" fill="none" stroke-linecap="round" opacity=".9"/><path d="${d}" stroke="#4e8aa0" stroke-width="22" fill="none" opacity=".75"/>`;
  let d2 = "";
  for (let y = 0; y <= TILE; y += 20) d2 += `${y ? " L" : "M"}${(70 + 40 * Math.sin(y / TILE * Math.PI * 4 + 1)).toFixed(1)},${y}`;
  s += `<path d="${d2}" stroke="#b7a784" stroke-width="3" fill="none" opacity=".7"/>`;
  for (let i = 0; i < 16; i++) {
    const cx = rnd(10, W - 40), cy = rnd(60, TILE - 80);
    for (let k = 0; k < 9; k++) {
      const x = cx + rnd(0, 34), y = cy + rnd(0, 28), w = rnd(8, 14), h = rnd(8, 14);
      s += `<rect x="${(x + 2).toFixed(1)}" y="${(y + 3).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="rgba(0,0,0,.3)"/><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${k % 3 ? "#6b3b33" : "#4b4d55"}"/>`;
    }
  }
  return `${s}</svg>`;
}

export function cloudTileSvg(W, h, n, op, rand = seeded(2)) {
  const rnd = (a, b) => a + rand() * (b - a);
  let s = `<svg width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" style="filter:blur(7px)">`;
  for (let i = 0; i < n; i++) {
    const x = rnd(-30, W + 30), y = rnd(0, h);
    for (let k = 0; k < 5; k++) s += `<circle cx="${(x + rnd(-40, 40)).toFixed(1)}" cy="${(y + rnd(-14, 14)).toFixed(1)}" r="${rnd(14, 34).toFixed(1)}" fill="#fff" opacity="${op}"/>`;
  }
  return `${s}</svg>`;
}

export function rockSvg(r) {
  return `<svg width="${r * 5}" height="${r * 5}" viewBox="-50 -50 100 100" style="overflow:visible;position:absolute;left:${-r * 2.5}px;top:${-r * 2.5}px">
    <ellipse cx="14" cy="22" rx="40" ry="30" fill="#000" opacity=".28" style="filter:blur(5px)"/>
    <polygon points="-30,-8 -14,-34 12,-30 32,-6 26,24 0,34 -26,22" fill="#5b5f66"/>
    <polygon points="-16,-6 -6,-22 12,-18 20,-2 12,14 -8,16" fill="#7c8188"/>
    <polygon points="-6,-8 2,-14 10,-8 4,2 -4,2" fill="#a6aaa0"/></svg>`;
}
