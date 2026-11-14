/**
 * Sky Regatta Standings: an F1-style leaderboard for the Sky Regatta race.
 * Everyone sees the tower. Only the GM sees the controls (roll next section, undo, reset).
 * State lives in a world setting, so Foundry syncs it to every client by itself (no sockets needed).
 */
import {
  freshState, resolveSection, undo as undoState, nextSection, isFinished, buildReport,
} from "./engine.mjs";
import { towerContext, validateInput, readoutFor } from "./view.mjs";
import { captureTops, playSlides } from "./animate.mjs";

const MODULE_ID = "sky-regatta-tower";
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

let app = null;
let lastCommandId = null;
let busy = false;

const getState = () => {
  const s = game.settings.get(MODULE_ID, "state");
  return s && s.version ? foundry.utils.deepClone(s) : null;
};
const opts = () => ({ npcFouls: game.settings.get(MODULE_ID, "npcFouls") });
const d6 = async () => (await new Roll("1d6").evaluate()).total;

async function whisper(html) {
  const gms = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
  await ChatMessage.create({ content: html, whisper: gms, speaker: { alias: "Sky Regatta" } });
}

/** Resolve the next section, save, and post the GM report. `unlocked` skips the VP range checks. */
async function rollNext(input = {}, unlocked = false) {
  if (!game.user.isGM || busy) return;
  busy = true;
  try {
    const state = getState() ?? freshState();
    if (isFinished(state)) { ui.notifications.warn("The race is finished. Reset it to run again."); return; }
    const problem = validateInput(state, input, unlocked);
    if (problem) { ui.notifications.warn(problem); return; }
    const report = await resolveSection(state, input, d6, opts());
    await game.settings.set(MODULE_ID, "state", state);
    await whisper(buildReport(state, report));
  } finally { busy = false; }
}

async function undoLast() {
  if (!game.user.isGM || busy) return;
  const state = getState();
  const prev = state ? undoState(state) : null;
  if (!prev) { ui.notifications.warn("Nothing to undo."); return; }
  await game.settings.set(MODULE_ID, "state", prev);
  const nx = nextSection(prev);
  await whisper(`<b>Sky Regatta:</b> undid the last section. Next up: Lap ${nx.lap}, Section ${nx.key} (${nx.name}).`);
}

async function resetRace(skipConfirm = false) {
  if (!game.user.isGM) return;
  if (!skipConfirm) {
    const ok = await DialogV2.confirm({ window: { title: "Reset the race?" }, content: "<p>This clears all VP totals and history.</p>" });
    if (!ok) return;
  }
  await game.settings.set(MODULE_ID, "state", freshState());
  await whisper("<b>Sky Regatta:</b> race reset. Next up: Lap 1, Section A (Entry).");
}

/** GM: open the standings window on every connected client (players too), even before the first roll. */
async function showToPlayers() {
  if (!game.user.isGM) return;
  await game.settings.set(MODULE_ID, "showSignal", { id: foundry.utils.randomID(), at: Date.now() });
  ui.notifications.info("Sky Regatta standings shown to players.");
}

/** Lets a macro or the MCP drive the race: write {id, action, input} to the "command" setting. */
async function runCommand(cmd) {
  if (!cmd || !cmd.id || cmd.id === lastCommandId) return;
  if (!game.user.isGM || game.users.activeGM?.id !== game.user.id) return; // exactly one GM client acts
  lastCommandId = cmd.id;
  if (cmd.action === "roll") await rollNext(cmd.input ?? {}, !!cmd.unlock);
  else if (cmd.action === "undo") await undoLast();
  else if (cmd.action === "reset") await resetRace(true);
  else if (cmd.action === "open") getApp().render({ force: true });
  else if (cmd.action === "show") await showToPlayers();
}

function getApp() { return (app ??= new SkyRegattaTower()); }

class SkyRegattaTower extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "sky-regatta-tower",
    classes: ["sky-regatta"],
    tag: "div",
    window: { title: "Sky Regatta", resizable: true, minimizable: true },
    position: { width: 420, height: "auto" },
    actions: {
      roll: SkyRegattaTower.#onRoll,
      undo: SkyRegattaTower.#onUndo,
      reset: SkyRegattaTower.#onReset,
      step: SkyRegattaTower.#onStep,
      show: SkyRegattaTower.#onShow,
    },
  };

  static PARTS = { tower: { template: `modules/${MODULE_ID}/templates/tower.hbs` } };

  #prevTops = null;    // row positions before this redraw, for the slide animation

  async _prepareContext() {
    this.#prevTops = this.element ? captureTops(this.element) : null;   // the old rows are still on screen here
    const state = getState() ?? freshState();
    const showPortraits = game.settings.get(MODULE_ID, "showPortraits");
    return towerContext(state, {
      isGM: game.user.isGM,
      portraitFor: showPortraits ? (r) => game.actors.getName(r.actor)?.img ?? null : null,
    });
  }

  /** Live "= new total" readout beside each PC stepper as the GM types or steps. */
  _onRender() {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (this.#prevTops && game.settings.get(MODULE_ID, "animate") && !reduceMotion) playSlides(this.element, this.#prevTops);
    this.#prevTops = null;
    for (const input of this.element.querySelectorAll("input[data-kind='pc']")) {
      input.addEventListener("input", () => this.#updateReadout(input));
    }
  }

  #updateReadout(input) {
    const { total, ok } = readoutFor(Number(input.dataset.base), input.value, Number(input.dataset.min), Number(input.dataset.max));
    const out = this.element.querySelector(`[data-total-for="${input.dataset.id}"]`);
    if (out) out.textContent = total;
    this.element.querySelector(`[data-pc="${input.dataset.id}"]`)?.classList.toggle("bad", !ok);
    this.element.querySelector(`[data-hint-for="${input.dataset.id}"]`)?.classList.toggle("bad", !ok);
  }

  #unlocked() { return !!this.element.querySelector("input[name='unlock']")?.checked; }

  static #onStep(event, target) {
    const input = this.element.querySelector(`input[name="${target.dataset.for}"]`);
    if (!input) return;
    let v = (Number(input.value) || 0) + Number(target.dataset.dir);
    if (!this.#unlocked()) v = Math.min(Number(input.dataset.max), Math.max(Number(input.dataset.min), v));
    input.value = v;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }

  static async #onRoll(event, target) {
    const form = this.element.querySelector(".srt-controls");
    const input = {};
    for (const el of form.querySelectorAll("input[name]")) {
      if (el.name === "unlock") continue;
      if (el.name.startsWith("gain_")) {              // PC stepper: points added; the engine wants the new total
        input[el.dataset.id] = Number(el.dataset.base) + (Number(el.value) || 0);
        continue;
      }
      if (el.type === "checkbox") input[el.name] = el.checked;
      else input[el.name] = el.value === "" ? undefined : Number(el.value);
    }
    target.disabled = true;
    try { await rollNext(input, this.#unlocked()); } finally { target.disabled = false; }
  }
  static async #onShow() { await showToPlayers(); }
  static async #onUndo() { await undoLast(); }
  static async #onReset() { await resetRace(); }
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "state", {
    scope: "world", config: false, type: Object, default: {},
    onChange: () => {
      const hasState = !!getState();
      if (app?.rendered) app.render();
      else if (hasState && game.settings.get(MODULE_ID, "autoOpen")) getApp().render({ force: true });
    },
  });
  game.settings.register(MODULE_ID, "command", {
    scope: "world", config: false, type: Object, default: {},
    onChange: (value) => { runCommand(value); },
  });
  game.settings.register(MODULE_ID, "showSignal", {
    scope: "world", config: false, type: Object, default: {},
    // fires on every client when the GM presses "Show to players": open the window everywhere
    onChange: (value) => { if (value?.id) getApp().render({ force: true }); },
  });
  game.settings.register(MODULE_ID, "autoOpen", {
    name: "Open the standings automatically",
    hint: "Open the Sky Regatta standings window whenever the GM resolves a section.",
    scope: "client", config: true, type: Boolean, default: true,
  });
  game.settings.register(MODULE_ID, "animate", {
    name: "Animate the standings",
    hint: "Slide the rows up and down when riders change position. Turn off on a slow computer.",
    scope: "client", config: true, type: Boolean, default: true,
  });
  game.settings.register(MODULE_ID, "showPortraits", {
    name: "Show actor portraits",
    hint: "Show each rider's actor image next to their name (looks actors up by name).",
    scope: "world", config: true, type: Boolean, default: false,
    onChange: () => app?.render(),
  });
  game.settings.register(MODULE_ID, "npcFouls", {
    name: "NPC fouls",
    hint: "An NPC attack roll of 1 is a foul: -1 VP.",
    scope: "world", config: true, type: Boolean, default: false,
  });
});

Hooks.once("ready", () => {
  const mod = game.modules.get(MODULE_ID);
  mod.api = {
    open: () => getApp().render({ force: true }),
    show: showToPlayers,
    rollNext, undo: undoLast, reset: resetRace,
    getState,
  };
});
