/**
 * Who sees a roll. The tower's rolls follow the chat's own roll visibility ("Public Roll", "Private GM Roll", "Blind GM Roll",
 * "Self Roll"), set per person in the chat box. A player's roll runs on the GM's computer, so the player's mode is sent along
 * with the request and applied here. Pure JavaScript, unit tested.
 */
export const ROLL_MODES = ["publicroll", "gmroll", "blindroll", "selfroll"];

/** A usable mode: the one asked for, or (if it is missing or unknown) public for a player and a private GM roll for a GM. */
export const normalizeMode = (mode, isGM = false) => (ROLL_MODES.includes(mode) ? mode : isGM ? "gmroll" : "publicroll");

/**
 * The chat message fields that give a roll the right audience.
 * @param {string} mode      one of ROLL_MODES
 * @param {string} userId    the person who rolled
 * @param {string[]} gmIds   every GM
 * @returns {{ whisper?: string[], blind?: boolean }}  empty for a public roll
 */
export function visibility(mode, userId, gmIds) {
  switch (mode) {
    case "gmroll": return { whisper: [...new Set([...gmIds, userId])] };
    case "blindroll": return { whisper: [...new Set(gmIds)], blind: true };
    case "selfroll": return { whisper: [userId] };
    default: return {};
  }
}
