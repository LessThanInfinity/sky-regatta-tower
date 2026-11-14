/**
 * Sky Regatta Standings: an F1-style leaderboard for the Sky Regatta race.
 * Everyone sees the tower. Only the GM sees the controls (roll next section, undo, reset).
 * State lives in a world setting, so Foundry syncs it to every client by itself. Players ask the GM's client
 * to make their rolls over the module socket, so there is one source of truth and nothing to trust.
 */
import {
  ROSTER, SECTIONS, freshState, normalizeState, resolveSection, undo as undoState, nextSection, isFinished, buildReport,
} from "./engine.mjs";
import { towerContext, validateInput, readoutFor } from "./view.mjs";
import { captureTops, playSlides } from "./animate.mjs";
import { captureDraft, applyDraft } from "./draft.mjs";
import {
  SKILL_LABEL, PARTY_BONUS, sectionMenu, validatePcRequest, computeMod, applyPcCheck, applyNarrows, clearPcRoll,
  eligibleTargets, planNpcDice, degreeOf, buildNpcDiceHtml, buildDcCardHtml, buildPcRollHtml, buildNarrowsHtml, buildDialogHtml,
} from "./rolls.mjs";

const MODULE_ID = "sky-regatta-tower";
const CHANNEL = `module.${MODULE_ID}`;
const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

let app = null;
let lastCommandId = null;
let busy = false;
let queue = Promise.resolve();     // serialises roll requests so two players can't overwrite each other

const getState = () => {
  const s = game.settings.get(MODULE_ID, "state");
  return s && s.version ? normalizeState(foundry.utils.deepClone(s)) : null;
};
const saveState = (state) => game.settings.set(MODULE_ID, "state", state);
const opts = () => ({ npcFouls: game.settings.get(MODULE_ID, "npcFouls") });
const autoVp = () => game.settings.get(MODULE_ID, "autoVp");
const d6 = async () => (await new Roll("1d6").evaluate()).total;
const isActiveGM = () => game.user.isGM && game.users.activeGM?.id === game.user.id;

const gmIds = () => ChatMessage.getWhisperRecipients("GM").map((u) => u.id);

async function whisper(html) {
  const gms = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
  await ChatMessage.create({ content: html, whisper: gms, speaker: { alias: "Sky Regatta" } });
}

// ---------- actors and modifiers ----------
const actorFor = (entry) => game.actors.getName(entry.actor);
/** A skill modifier from the PF2e actor, falling back to the numbers stored in the roster. */
function skillMod(entry, skill) {
  const a = actorFor(entry);
  let m;
  if (a) m = skill === "perception" ? (a.perception?.mod ?? a.system?.perception?.mod) : (a.skills?.[skill]?.mod ?? a.system?.skills?.[skill]?.mod);
  return Number.isFinite(m) ? m : (entry.skills?.[skill] ?? 0);
}
/** The race PCs this user may roll for (the GM may roll for both). */
function ridersFor(user) {
  return ROSTER.filter((r) => r.pc).filter((r) => {
    const a = actorFor(r);
    return user.isGM || (a && a.testUserPermission(user, "OWNER"));
  });
}

// ---------- the GM's section roll ----------
/** Resolve the next section, save, show the NPCs' dice, and post the GM report. `unlocked` skips the VP range checks. */
async function rollNext(input = {}, unlocked = false) {
  if (!game.user.isGM || busy) return;
  busy = true;
  try {
    const state = getState() ?? freshState();
    if (isFinished(state)) { ui.notifications.warn("The race is finished. Reset it to run again."); return; }
    const problem = validateInput(state, input, unlocked);
    if (problem) { ui.notifications.warn(problem); return; }
    const report = await resolveSection(state, input, d6, opts());
    await saveState(state);
    if (game.settings.get(MODULE_ID, "npcDice")) await postNpcDice(report);
    await whisper(buildReport(state, report));
  } finally { busy = false; }
}

/** Real d20s for the six NPCs, for the table's benefit. The d6 table decides VP; these are theatre (and Dice So Nice fires). */
async function postNpcDice(report) {
  const npcs = ROSTER.filter((r) => !r.pc);
  const attackers = new Set(npcs.filter((n) => (report.notes[n.id] ?? []).some((t) => t.startsWith("Attacks "))).map((n) => n.id));
  // who each NPC actually went after in Battle (the engine already decided), so the show matches the result
  const battleTargets = {};
  for (const n of npcs) for (const t of report.notes[n.id] ?? []) {
    let mt;
    if ((mt = /^Attacks ([^:]+):/.exec(t))) battleTargets[n.id] = { kind: "attack", target: mt[1] };
    else if ((mt = /^Draft behind ([^:]+):/.exec(t))) battleTargets[n.id] = { kind: "draft", target: mt[1] };
  }
  const plan = planNpcDice(npcs, report.lap, report.key, skillMod, attackers, { before: report.before, battleTargets });
  const rolls = [];
  const rows = [];
  for (const p of plan) {
    const roll = await new Roll("1d20").evaluate();
    rolls.push(roll);
    const nat = roll.total;
    const total = nat + p.mod;
    rows.push({ ...p, nat, total, degree: degreeOf(total, p.dc, nat) });
  }
  const data = { speaker: { alias: "The field" }, content: buildNpcDiceHtml(report.lap, report.key, rows), rolls, sound: CONFIG.sounds.dice };
  if (!game.settings.get(MODULE_ID, "npcDiceVisible")) data.whisper = ChatMessage.getWhisperRecipients("GM").map((u) => u.id);
  await ChatMessage.create(data);
}

async function undoLast() {
  if (!game.user.isGM || busy) return;
  const state = getState();
  const prev = state ? undoState(state) : null;
  if (!prev) { ui.notifications.warn("Nothing to undo."); return; }
  await saveState(prev);
  const nx = nextSection(prev);
  await whisper(`<b>Sky Regatta:</b> undid the last section. Next up: Lap ${nx.lap}, Section ${nx.key} (${nx.name}).`);
}

async function resetRace(skipConfirm = false) {
  if (!game.user.isGM) return;
  if (!skipConfirm) {
    const ok = await DialogV2.confirm({ window: { title: "Reset the race?" }, content: "<p>This clears all VP totals and history.</p>" });
    if (!ok) return;
  }
  await saveState(freshState());
  await whisper("<b>Sky Regatta:</b> race reset. Next up: Lap 1, Section A (Entry).");
}

/** GM: open the standings window on every connected client (players too), even before the first roll. */
async function showToPlayers() {
  if (!game.user.isGM) return;
  await game.settings.set(MODULE_ID, "showSignal", { id: foundry.utils.randomID(), at: Date.now() });
  ui.notifications.info("Sky Regatta standings shown to players.");
}

// ---------- DC card and the players' rolls ----------
/** GM: post the current section's DCs to chat, with a button players click to roll. */
async function postDcCard() {
  if (!game.user.isGM) return;
  const state = getState() ?? freshState();
  if (isFinished(state)) { ui.notifications.warn("The race is finished."); return; }
  await ChatMessage.create({ speaker: { alias: "Sky Regatta" }, content: buildDcCardHtml(state, state.lap, SECTIONS[state.sec]) });
}

function reject(userId, reason) {
  if (userId === game.user.id) ui.notifications.warn(reason);
  else game.socket.emit(CHANNEL, { type: "reject", userId, reason });
}

/** Runs on the active GM's client: validate, roll, apply to the state, post the chat card. */
function queuePcRoll(request, userId) {
  queue = queue.then(() => executePcRoll(request, userId)).catch((err) => { console.error(`${MODULE_ID} | roll failed`, err); reject(userId, "Something went wrong with that roll. Tell the GM."); });
}

async function executePcRoll(req, userId) {
  const state = getState() ?? freshState();
  const user = game.users.get(userId);
  const entry = ROSTER.find((r) => r.id === req.pcId && r.pc);
  const actor = entry ? actorFor(entry) : null;
  if (!user || !entry) return reject(userId, "That rider isn't in the race.");
  if (!user.isGM && !(actor && actor.testUserPermission(user, "OWNER"))) return reject(userId, `You don't control ${entry.name}.`);
  const v = validatePcRequest(state, req);
  if (!v.ok) return reject(userId, v.error);
  const speaker = ChatMessage.getSpeaker({ actor });

  if (v.choice.special === "narrows") {
    if (req.spendFavor) return reject(userId, "Favor can't be spent on the Narrows.");
    const rolls = [], chat = [];
    for (const skill of [...new Set(req.narrows)]) {
      const mod = computeMod(state, entry.id, "N", { bench: req.bench }, skillMod(entry, skill)).total;
      const roll = await new Roll("1d20").evaluate();
      rolls.push({ skill, nat: roll.total, mod });
      chat.push(roll);
    }
    const res = applyNarrows(state, req, rolls, { autoVp: autoVp() });
    if (!res.ok) return reject(userId, res.error);
    await saveState(state);
    await ChatMessage.create({ speaker, whisper: gmIds(), rolls: chat, sound: CONFIG.sounds.dice, content: buildNarrowsHtml({ pcName: entry.name, checks: res.checks, vp: res.pending.suggested, notes: res.pending.notes, auto: autoVp() }) });
    return;
  }

  const m = computeMod(state, entry.id, v.key, req, skillMod(entry, v.choice.skill));
  const roll = await new Roll("1d20").evaluate();
  const res = applyPcCheck(state, req, { nat: roll.total, mod: m.total, parts: m.parts }, { autoVp: autoVp() });
  if (!res.ok) return reject(userId, res.error);
  await saveState(state);
  const p = res.pending;
  await ChatMessage.create({
    speaker, whisper: gmIds(), rolls: [roll], sound: CONFIG.sounds.dice,
    content: buildPcRollHtml({ pcName: entry.name, choice: v.choice, lineId: v.lineId, dc: v.dc, nat: roll.total, parts: m.parts, total: p.total, degree: p.degree, vp: p.suggested, notes: p.notes, auto: autoVp() }),
  });
}

/** The skill picker a player sees after clicking "Roll my check". */
async function openRollDialog(where = {}) {
  const state = getState() ?? freshState();
  if (isFinished(state)) return ui.notifications.warn("The race is finished.");
  const key = SECTIONS[state.sec];
  if (where.lap && (where.lap !== state.lap || where.key !== key)) ui.notifications.info("That DC card is for an earlier section, so I opened the current one.");
  const mine = ridersFor(game.user);
  if (!mine.length) return ui.notifications.warn("You don't control Violet or Aji, so there is nothing for you to roll.");
  let entry = mine[0];
  if (mine.length > 1) {
    const picked = await DialogV2.wait({
      window: { title: "Roll for which rider?" }, content: "<p>Which rider is rolling?</p>", rejectClose: false,
      buttons: mine.map((r, i) => ({ action: r.id, label: r.name, default: i === 0 })),
    });
    entry = mine.find((r) => r.id === picked);
    if (!entry) return;
  }
  if (state.pending[entry.id]) return ui.notifications.warn(`${entry.name} has already rolled this section: ${state.pending[entry.id].summary}`);

  const menu = sectionMenu(state.lap, key);
  const mods = Object.fromEntries(Object.keys(SKILL_LABEL).map((s) => [s, skillMod(entry, s)]));
  const targets = eligibleTargets(state, entry.id).filter((t) => !(key === "C" && state.lap !== 4 && state.sheltered[t.id]));
  const result = await DialogV2.wait({
    window: { title: `${entry.name}: ${menu.title} (Lap ${state.lap})` },
    position: { width: 540 },
    content: buildDialogHtml(state, entry.id, menu, { mods, targets, key }),
    rejectClose: false,
    buttons: [
      {
        action: "roll", label: "Roll!", icon: "fa-solid fa-dice-d20", default: true,
        callback: (event, button) => {
          const fd = new FormData(button.form);
          return {
            choiceId: fd.get("choice"), lineId: fd.get("line") || undefined, target: fd.get("target") || undefined,
            bench: Number(fd.get("bench") || 0), spendFavor: fd.get("spendFavor") === "on", narrows: fd.getAll("narrows"),
          };
        },
      },
      { action: "cancel", label: "Cancel" },
    ],
  });
  if (!result || typeof result !== "object") return;
  const request = { pcId: entry.id, lap: state.lap, key, ...result };
  const check = validatePcRequest(state, request);
  if (!check.ok) return ui.notifications.warn(check.error);
  if (game.user.isGM) {
    if (!isActiveGM()) return ui.notifications.warn("Another GM is the active one; ask them to roll.");
    queuePcRoll(request, game.user.id);
  } else game.socket.emit(CHANNEL, { type: "pcRoll", userId: game.user.id, request });
}

// ---------- GM tweaks from the tower ----------
async function clearRoll(pcId) {
  if (!game.user.isGM) return;
  const state = getState();
  if (!state || !clearPcRoll(state, pcId)) return;
  await saveState(state);
}
async function adjustDrake(pcId, dir) {
  if (!game.user.isGM) return;
  const state = getState() ?? freshState();
  state.drake[pcId] = Math.min(3, Math.max(0, (state.drake[pcId] ?? 0) + dir));
  await saveState(state);
}
async function adjustFavor(dir) {
  if (!game.user.isGM) return;
  const state = getState() ?? freshState();
  state.favor.party = Math.max(0, (state.favor.party ?? 0) + dir);
  await saveState(state);
}

/** Lets a macro or the MCP drive the race: write {id, action, input} to the "command" setting. */
async function runCommand(cmd) {
  if (!cmd || !cmd.id || cmd.id === lastCommandId) return;
  if (!isActiveGM()) return;                          // exactly one GM client acts
  lastCommandId = cmd.id;
  if (cmd.action === "roll") await rollNext(cmd.input ?? {}, !!cmd.unlock);
  else if (cmd.action === "undo") await undoLast();
  else if (cmd.action === "reset") await resetRace(true);
  else if (cmd.action === "open") getApp().render({ force: true });
  else if (cmd.action === "show") await showToPlayers();
  else if (cmd.action === "postDcs") await postDcCard();
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
      postDcs: SkyRegattaTower.#onPostDcs,
      rollCheck: SkyRegattaTower.#onRollCheck,
      useSuggested: SkyRegattaTower.#onUseSuggested,
      clearRoll: SkyRegattaTower.#onClearRoll,
      drake: SkyRegattaTower.#onDrake,
      favor: SkyRegattaTower.#onFavor,
    },
  };

  static PARTS = { tower: { template: `modules/${MODULE_ID}/templates/tower.hbs` } };

  #prevTops = null;    // row positions before this redraw, for the slide animation
  #draft = null;       // what the GM had typed in the control bar before this redraw
  #sectionKey = null;  // lap-and-section of the last render

  async _prepareContext() {
    this.#prevTops = this.element ? captureTops(this.element) : null;   // the old rows are still on screen here
    this.#draft = game.user.isGM ? captureDraft(this.element, this.#sectionKey) : null;
    const state = getState() ?? freshState();
    const showPortraits = game.settings.get(MODULE_ID, "showPortraits");
    return towerContext(state, {
      isGM: game.user.isGM,
      canRoll: ridersFor(game.user).length > 0,
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
    const st = getState() ?? freshState();
    const key = `${st.lap}-${st.sec}`;
    // A player rolling shouldn't wipe what the GM typed: put it back while we're still in the same section.
    applyDraft(this.element, this.#draft, key, (el) => { if (el.dataset.kind === "pc") this.#updateReadout(el); });
    this.#draft = null;
    this.#sectionKey = key;
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
  static async #onPostDcs() { await postDcCard(); }
  static async #onRollCheck() { await openRollDialog(); }
  static #onUseSuggested(event, target) {
    const input = this.element.querySelector(`input[name="${target.dataset.for}"]`);
    if (!input) return;
    input.value = Number(target.dataset.value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  static async #onClearRoll(event, target) { await clearRoll(target.dataset.pc); }
  static async #onDrake(event, target) { await adjustDrake(target.dataset.pc, Number(target.dataset.dir)); }
  static async #onFavor(event, target) { await adjustFavor(Number(target.dataset.dir)); }
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
  game.settings.register(MODULE_ID, "autoVp", {
    name: "Player rolls set VP automatically",
    hint: "Off (default): a player's roll shows the degree and suggests VP, and you set the VP yourself with the steppers. On: the roll's VP is filled in for you.",
    scope: "world", config: true, type: Boolean, default: false,
  });
  game.settings.register(MODULE_ID, "npcDice", {
    name: "Roll d20s for the NPC riders",
    hint: "Each section, roll a real d20 per NPC against a DC using their skills, for show. The d6 table still decides their VP.",
    scope: "world", config: true, type: Boolean, default: true,
  });
  game.settings.register(MODULE_ID, "npcDiceVisible", {
    name: "Show the NPC d20s to players",
    hint: "On: players see the dice (and Dice So Nice animates them). Off (default): only the GM sees them.",
    scope: "world", config: true, type: Boolean, default: false,
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
    postDcs: postDcCard,
    rollCheck: openRollDialog,
    rollNext, undo: undoLast, reset: resetRace,
    getState,
  };
  game.socket.on(CHANNEL, (data) => {
    if (data?.type === "pcRoll") { if (isActiveGM()) queuePcRoll(data.request, data.userId); }
    else if (data?.type === "reject" && data.userId === game.user.id) ui.notifications.warn(data.reason);
  });
});

/** The "Roll my check" button on a posted DC card. */
Hooks.on("renderChatMessageHTML", (message, html) => {
  html.querySelectorAll("[data-srt-action='roll']").forEach((btn) => {
    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      openRollDialog({ lap: Number(btn.dataset.lap), key: btn.dataset.key });
    });
  });
});
