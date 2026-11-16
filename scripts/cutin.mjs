/**
 * Crit cut-ins for the Sky Regatta. The tower posts its own chat cards, so Cinematic Cut-ins never sees a PF2e
 * roll message (it only reacts to messages carrying PF2e's roll context). When a rider's check is a critical
 * success, we play the actor's own cut-in through the Cinematic Cut-ins API instead.
 * Kept free of Foundry globals (everything is passed in) so it can be unit tested.
 */
export const CUTIN_ID = "cinematic-cut-ins";

/** True when any of the given degrees is a critical success. */
export const isCrit = (degrees) => [].concat(degrees ?? []).includes("critSuccess");

/**
 * Builds the playable data for an actor's active Cinematic Cut-ins config, the same way the module does for its
 * own triggers. Returns null when the actor has no cut-in set up.
 */
export function buildCutInData(actor, cutinManager, clone = (o) => structuredClone(o)) {
  const config = actor?.getFlag?.(CUTIN_ID, "config");
  if (!config || typeof config !== "object" || !Object.keys(config).length) return null;
  let data = clone(config);
  data.actorId = actor.uuid;
  if (!Array.isArray(data.layers)) data.layers = [];
  if (cutinManager?.applyRandomization) data = cutinManager.applyRandomization(data);
  if (cutinManager?.processText) {
    const ctx = { actor, item: null };
    if (data.text) data.text = cutinManager.processText(data.text, ctx);
    if (data.subText) data.subText = cutinManager.processText(data.subText, ctx);
  }
  return data;
}

/**
 * Plays the actor's crit cut-in for everyone. Returns "played", or the reason it was skipped.
 * `api` is game.modules.get("cinematic-cut-ins")?.api.
 */
export function playCritCutIn(actor, api, clone) {
  if (!api?.play) return "no-module";
  if (!actor) return "no-actor";
  const data = buildCutInData(actor, api.CutinManager, clone);
  if (!data) return "no-config";
  api.play(data);
  return "played";
}
