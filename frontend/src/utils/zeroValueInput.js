// Numeric inputs across the project default to "0" (amounts, rates, etc.).
// Typing the first digit into a focused "0" field should replace it, not
// append after it ("0" + "2" must show "2", not "02"/"0200"). Rather than
// touching every amount field's own onChange handler, auto-select the "0"
// on focus so the browser's native type-over-selection does the replacing
// for free -- no change to any field's value, validation or save logic.
export function enableZeroSelectOnFocus(root) {
  const handler = event => {
    const el = event.target;
    if (el.tagName !== "INPUT" || el.type !== "number") return;
    if (el.value !== "" && Number(el.value) === 0) el.select();
  };
  root.addEventListener("focusin", handler);
  return () => root.removeEventListener("focusin", handler);
}
