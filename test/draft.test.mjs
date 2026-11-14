import test from "node:test";
import assert from "node:assert/strict";
import { captureDraft, applyDraft } from "../scripts/draft.mjs";

const field = (name, value, type = "number") => ({ name, type, value: String(value), defaultValue: String(value), checked: false, defaultChecked: false });
const root = (fields) => ({
  querySelectorAll: () => fields,
  querySelector: (sel) => fields.find((f) => sel.includes(`"${f.name}"`)) ?? null,
});

test("only fields the GM changed are captured", () => {
  const a = field("gain_violet", 0), b = field("gain_aji", 0), c = { ...field("unlock", "on", "checkbox") };
  a.value = "3";                          // changed by the GM
  const d = captureDraft(root([a, b, c]), "1-0");
  assert.deepEqual(d, { sectionKey: "1-0", fields: { gain_violet: "3" } });
  assert.equal(captureDraft(root([b]), "1-0"), null);
});

test("checkboxes the GM ticked are captured too", () => {
  const box = field("unlock", "", "checkbox"); box.checked = true;
  assert.deepEqual(captureDraft(root([box]), "2-1").fields, { unlock: true });
});

test("a redraw in the same section restores the values, a new section does not", () => {
  const a = field("gain_violet", 0); a.value = "2";
  const draft = captureDraft(root([a]), "1-0");
  const fresh = field("gain_violet", 0);                    // the redrawn field, back at its default
  const seen = [];
  assert.equal(applyDraft(root([fresh]), draft, "1-0", (el) => seen.push(el.name)), 1);
  assert.equal(fresh.value, "2");
  assert.deepEqual(seen, ["gain_violet"]);
  const next = field("gain_violet", 0);
  assert.equal(applyDraft(root([next]), draft, "1-1"), 0);  // the section moved on
  assert.equal(next.value, "0");
});

test("nothing happens with no draft or no DOM", () => {
  assert.equal(applyDraft(root([]), null, "1-0"), 0);
  assert.equal(captureDraft(null, "1-0"), null);
});
