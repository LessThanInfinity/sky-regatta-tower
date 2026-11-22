/**
 * The race view: a portrait, top-down window of the eight drakes, docked beside the standings tower.
 * It only ever reads the standings (VP per rider) and moves the drakes to match; it never changes the race.
 *
 * The drakes are cutouts: the artwork never redraws, it is moved with transforms (wings fold at the shoulder, the tail
 * sways, the drake banks into turns) while the ground, clouds and rocks scroll past at different speeds to fake depth.
 * The view lives outside the Foundry window's template, so it keeps animating when the tower redraws.
 */
import { planRace, VIEW } from "./racelayout.mjs";
import { DEFS_SVG, wyvernSvg, groundTileSvg, cloudTileSvg, rockSvg, seeded } from "./wyvern.mjs";

const SPEED = { ground: 58, cloud: 120, front: 250, rock: 112 };
const TILE = 1400;

/** Each rider's own drake colors (body and bones, wing membrane) and the letters on the token when there is no portrait. */
export const DRAKE_LOOK = {
  violet:   { body: "#2f2250", memb: "#5d4f80", mark: "VI" },
  aji:      { body: "#22344f", memb: "#51657e", mark: "AJ" },
  viridian: { body: "#183a2b", memb: "#4a6e5c", mark: "VR" },
  ivory:    { body: "#6f695c", memb: "#b4ab98", mark: "IV" },
  syu:      { body: "#5a3f10", memb: "#9c7c48", mark: "SY" },
  ranto:    { body: "#47200f", memb: "#85563f", mark: "RN" },
  sarah:    { body: "#4a1424", memb: "#8c4254", mark: "SA" },
  dutch:    { body: "#1b1f24", memb: "#505862", mark: "DU" },
};

export class RaceView {
  /**
   * @param {{id:string,name:string,color:string}[]} riders   in roster order; color is the team color for the token ring
   * @param {{tokenFor?: (id:string)=>string|null, reducedMotion?: ()=>boolean}} opts
   */
  constructor(riders, { tokenFor = () => null, reducedMotion = () => false } = {}) {
    this.riders = riders.map((r) => ({
      ...r, look: DRAKE_LOOK[r.id] ?? { body: "#333", memb: "#666", mark: r.name.slice(0, 2).toUpperCase() },
      x: VIEW.W / 2, y: VIEW.H + 90, bx: VIEW.W / 2, ty: VIEW.H + 90, rank: 0, ph: 0, wf: 0, amp: 0, flap: 0, drift: 0, pulse: 0, trail: [[], []],
    }));
    const rand = seeded(7);
    this.riders.forEach((r, i) => { r.ph = rand() * 6.28; r.wf = 0.55 + rand() * 0.25; r.drift = 7 + rand() * 6; r.flap = i; r.amp = 0.3; });
    this.ids = this.riders.map((r) => r.id);
    this.tokenFor = tokenFor;
    this.reducedMotion = reducedMotion;
    this.plan = null;
    this.cam = { cur: 1, target: 1 };
    this.scroll = { ground: 0, cloud: 0, front: 0 };
    this.rocks = [];
    this.sig = "";
    this.running = false;
    this.raf = 0;
    this.last = 0;
    this.#build();
  }

  #build() {
    const W = VIEW.W, H = VIEW.H;
    const root = document.createElement("div");
    root.className = "srt-v-fit";
    root.innerHTML = `${DEFS_SVG}<div class="srt-v-stage" style="width:${W}px;height:${H}px">
      <div class="srt-v-layer srt-v-ground"><div class="srt-v-scroller" data-layer="ground"></div></div>
      <div class="srt-v-layer" data-role="shadows"></div>
      <div class="srt-v-layer"><div class="srt-v-scroller" data-layer="cloud"></div></div>
      <div class="srt-v-layer" data-role="rocks"></div>
      <canvas class="srt-v-trails" width="${W}" height="${H}"></canvas>
      <div class="srt-v-layer" data-role="drakes"></div>
      <div class="srt-v-layer"><div class="srt-v-scroller" data-layer="front"></div></div>
      <div class="srt-v-layer srt-v-haze"></div>
      <div class="srt-v-layer srt-v-vig"></div>
      <div class="srt-v-cap"></div></div>`;
    this.root = root;
    this.stage = root.querySelector(".srt-v-stage");
    this.cap = root.querySelector(".srt-v-cap");
    const q = (s) => root.querySelector(s);

    const tiles = (layer, svg, h) => { q(`[data-layer="${layer}"]`).innerHTML = `<div class="srt-v-tile" style="top:0;height:${h}px">${svg}</div><div class="srt-v-tile" style="top:${-h}px;height:${h}px">${svg}</div>`; this.scroll[`${layer}H`] = h; };
    tiles("ground", groundTileSvg(W, TILE, seeded(11)), TILE);
    tiles("cloud", cloudTileSvg(W, 1100, 9, 0.5, seeded(12)), 1100);
    tiles("front", cloudTileSvg(W, 1700, 5, 0.22, seeded(13)), 1700);
    this.scrollEls = { ground: q('[data-layer="ground"]'), cloud: q('[data-layer="cloud"]'), front: q('[data-layer="front"]') };

    const rand = seeded(21);
    for (let i = 0; i < 6; i++) {
      const r = 15 + rand() * 11;
      const el = document.createElement("div");
      el.className = "srt-v-rock"; el.innerHTML = rockSvg(r);
      q('[data-role="rocks"]').appendChild(el);
      this.rocks.push({ el, x: 40 + rand() * (W - 80), y: -rand() * 700, r: r * 1.4 });
    }

    for (const r of this.riders) {
      const d = document.createElement("div"); d.className = "srt-v-drake";
      d.style.setProperty("--c", r.look.body); d.style.setProperty("--m", r.look.memb);
      d.innerHTML = `<div class="srt-v-rot">${wyvernSvg()}</div><div class="srt-v-tok" style="--team:${r.color}"></div>`;
      const s = document.createElement("div"); s.className = "srt-v-drake srt-v-shade";
      s.style.setProperty("--c", "#000"); s.style.setProperty("--m", "#000");
      s.innerHTML = `<div class="srt-v-rot">${wyvernSvg()}</div>`;
      q('[data-role="drakes"]').appendChild(d); q('[data-role="shadows"]').appendChild(s);
      Object.assign(r, {
        el: d, sh: s, rot: d.querySelector(".srt-v-rot"), srot: s.querySelector(".srt-v-rot"), tok: d.querySelector(".srt-v-tok"),
        wings: [...d.querySelectorAll(".wing"), ...s.querySelectorAll(".wing")],
        tails: [...d.querySelectorAll(".tail"), ...s.querySelectorAll(".tail")],
      });
    }
    this.canvas = q(".srt-v-trails");
    this.ctx = this.canvas.getContext?.("2d") ?? null;
    this.refreshTokens();
  }

  /** Put each rider's token image (or their letters) on their drake. Call again if portraits are switched on or off. */
  refreshTokens() {
    for (const r of this.riders) {
      const src = this.tokenFor(r.id);
      r.tok.textContent = src ? "" : r.look.mark;
      r.tok.style.backgroundImage = src ? `url("${String(src).replace(/"/g, "%22")}")` : "";
      r.tok.classList.toggle("srt-v-img", !!src);
    }
  }

  /** Move the drakes to match the standings. Safe to call on every redraw: nothing happens unless the totals changed. */
  update(vp, delta = {}, caption = "") {
    this.cap.textContent = caption;
    const sig = this.ids.map((id) => vp[id] ?? 0).join(",");
    if (sig === this.sig) return;
    const first = this.sig === "";
    this.sig = sig;
    this.plan = planRace(vp, this.ids, this.plan?.riders ?? {});
    this.cam.target = this.plan.cam;
    for (const r of this.riders) {
      const p = this.plan.riders[r.id];
      r.rank = p.rank; r.ty = p.ty; r.bx = p.bx;
      if ((delta[r.id] ?? 0) > 0 && !first) r.pulse = 1;
    }
    if (this.reducedMotion()) this.#snap();
  }

  #snap() { for (const r of this.riders) { r.x = r.bx; r.y = r.ty; } this.cam.cur = this.cam.target; if (!this.running) this.#draw(0, 0.0001); }

  /** Attach the view inside the window's slot (the tower redraws its HTML, the view survives) and start animating. */
  mount(slot) {
    if (!slot) return;
    slot.replaceChildren(this.root);
    this.ro?.disconnect();
    if (typeof ResizeObserver !== "undefined") { this.ro = new ResizeObserver(() => this.fit(slot)); this.ro.observe(slot); }
    this.fit(slot);
    this.start();
  }

  /** Scale the fixed stage to whatever room the window gives it (letterboxed, never stretched). */
  fit(slot) {
    const w = slot?.clientWidth || VIEW.W, h = slot?.clientHeight || VIEW.H;
    const s = Math.min(w / VIEW.W, h / VIEW.H);
    this.stage.style.transform = `translate(-50%,-50%) scale(${s})`;
  }

  start() {
    if (this.running) return;
    if (this.reducedMotion()) { this.#snap(); this.#draw(0, 0.0001); return; }
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (this.root.isConnected && this.root.offsetWidth > 0) this.#draw(now / 1000, dt);   // skip the work while hidden or minimized
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() { this.running = false; cancelAnimationFrame(this.raf); this.ro?.disconnect(); }

  #draw(t, dt) {
    const W = VIEW.W, H = VIEW.H;
    const move = this.reducedMotion() ? 0 : 1;
    for (const k of ["ground", "cloud", "front"]) {
      const h = this.scroll[`${k}H`];
      this.scroll[k] = (this.scroll[k] + SPEED[k === "front" ? "front" : k] * dt * move) % h;
      this.scrollEls[k].style.transform = `translateY(${this.scroll[k]}px)`;
    }
    for (const o of this.rocks) {
      o.y += SPEED.rock * dt * move;
      if (o.y > H + 100) { o.y = -80 - Math.random() * 180; o.x = 40 + Math.random() * (W - 80); }
      o.el.style.transform = `translate(${o.x}px,${o.y}px)`;
    }
    const cx = this.ctx;
    cx?.clearRect(0, 0, W, H);
    this.cam.cur += (this.cam.target - this.cam.cur) * Math.min(1, dt * 1.6);
    const cz = this.cam.cur, ds = Math.max(0.6, cz);

    for (const r of this.riders) {
      const px = r.x, py = r.y;
      let dodge = 0;                                        // steer around the rocks
      for (const o of this.rocks) {
        const dy = o.y - r.y, dx = r.x - o.x, reach = (o.r + 52) * ds;
        if (dy > -50 && dy < 120 && Math.abs(dx) < reach) dodge += Math.sign(dx || 1) * (reach - Math.abs(dx)) * 0.9 * (1 - Math.min(1, Math.abs(dy - 30) / 100));
      }
      const weave = Math.sin(t * r.wf + r.ph) * r.drift * move;
      const tx = Math.max(72 * ds, Math.min(W - 72 * ds, W / 2 + (r.bx - W / 2) * cz + weave * ds + dodge * move));
      if (dt > 0) { r.x += (tx - r.x) * Math.min(1, dt * 2.4); r.y += (r.ty - r.y) * Math.min(1, dt * 1.5); }
      const vx = dt > 0 ? (r.x - px) / dt : 0, vy = dt > 0 ? (r.y - py) / dt : 0;
      const yaw = Math.max(-34, Math.min(34, Math.atan(vx / 105) * 57.3));
      const climbing = vy < -6;
      r.amp += ((climbing ? 1 : Math.abs(vy) > 6 ? 0.2 : 0.22 + 0.1 * Math.sin(t * 0.7 + r.ph)) - r.amp) * Math.min(1, dt * 3);
      if (!move) r.amp = 0.12;
      r.flap += dt * (3.4 + r.amp * 6.5);
      const z = 1 + 0.035 * Math.sin(t * 1.3 + r.ph) * move + (climbing ? 0.06 : 0) + r.pulse * 0.05;
      if (r.pulse) r.pulse = Math.max(0, r.pulse - dt * 1.3);
      const k = 1 - 0.42 * r.amp * (0.5 + 0.5 * Math.cos(r.flap)), a = 9 * r.amp * Math.sin(r.flap);
      const bank = Math.max(-0.16, Math.min(0.16, vx / 900));
      const wt = `translate(-7 -14) rotate(${a}) scale(${k} ${1 - 0.05 * r.amp * Math.sin(r.flap + 1)}) translate(7 14)`;
      for (const w of r.wings) w.setAttribute("transform", wt);
      const tt = `rotate(${Math.sin(t * 1.6 + r.ph) * 5 - yaw * 0.25} 0 14)`;
      for (const tl of r.tails) tl.setAttribute("transform", tt);
      r.el.style.transform = `translate(${r.x}px,${r.y}px)`;
      r.rot.style.transform = `rotate(${yaw}deg) scale(${z * ds * (1 - Math.abs(bank) * 0.6)},${z * ds})`;
      r.tok.style.transform = `scale(${ds})`;
      const lift = (z - 1) * 260 * ds;
      r.sh.style.transform = `translate(${r.x + 12 * ds + lift}px,${r.y + 20 * ds + lift}px)`;
      r.srot.style.transform = `rotate(${yaw}deg) scale(${0.96 * ds * (1 - Math.abs(bank) * 0.6)},${0.96 * ds})`;

      if (cx && move) {                                     // wingtip streaks in the air
        const ang = yaw * Math.PI / 180, span = 70 * k * z * ds;
        [-1, 1].forEach((sd, i) => {
          const tip = { x: r.x + Math.cos(ang) * span * sd + Math.sin(ang) * 2, y: r.y - Math.sin(ang) * span * sd - 22 * ds };
          const tr = r.trail[i];
          for (const p of tr) { p.y += SPEED.ground * 1.9 * dt; p.a -= dt * 1.1; }
          tr.push({ x: tip.x, y: tip.y, a: 0.55 * (0.4 + r.amp * 0.6) });
          while (tr.length && (tr[0].a <= 0 || tr.length > 26)) tr.shift();
          cx.lineWidth = 1.2; cx.lineCap = "round";
          for (let n = 1; n < tr.length; n++) { cx.strokeStyle = `rgba(255,255,255,${Math.max(0, tr[n].a * 0.7)})`; cx.beginPath(); cx.moveTo(tr[n - 1].x, tr[n - 1].y); cx.lineTo(tr[n].x, tr[n].y); cx.stroke(); }
        });
      }
    }
  }
}
