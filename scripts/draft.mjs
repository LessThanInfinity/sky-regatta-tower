/**
 * Keeps what the GM has typed into the control bar when the tower redraws (for example because a player rolled).
 * Only fields the GM actually changed are kept, and only while the section hasn't changed.
 */

/** Values of the control fields that differ from what the page rendered them with. */
export function captureDraft(root, sectionKey) {
  if (!root?.querySelectorAll) return null;
  const fields = {};
  for (const el of root.querySelectorAll(".srt-controls input[name]")) {
    if (el.type === "checkbox") { if (el.checked !== el.defaultChecked) fields[el.name] = el.checked; }
    else if (el.value !== el.defaultValue) fields[el.name] = el.value;
  }
  return Object.keys(fields).length ? { sectionKey, fields } : null;
}

/** Puts the captured values back (same section only). `onInput(el)` lets the caller refresh readouts. */
export function applyDraft(root, draft, sectionKey, onInput = () => {}) {
  if (!draft || draft.sectionKey !== sectionKey || !root?.querySelector) return 0;
  let n = 0;
  for (const [name, value] of Object.entries(draft.fields)) {
    const el = root.querySelector(`.srt-controls input[name="${name}"]`);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = value; else el.value = value;
    onInput(el);
    n++;
  }
  return n;
}
