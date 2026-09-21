import { useEffect } from "react";

const editableSelector = "input:not([type=hidden]), select, textarea, [role=combobox]";

function isEditable(element) {
  return element && element.matches(editableSelector) && !element.disabled && !element.readOnly && element.offsetParent !== null;
}

function fieldsFor(form) {
  return [...form.querySelectorAll(editableSelector)].filter(isEditable);
}

function focusNext(target, backwards = false) {
  const form = target.form || target.closest("form");
  if (!form) return false;
  const fields = fieldsFor(form);
  const index = fields.indexOf(target);
  if (index < 0) return false;
  const next = fields[index + (backwards ? -1 : 1)];
  if (next) { next.focus(); next.scrollIntoView?.({ block: "nearest", inline: "nearest" }); }
  else if (!backwards) form.querySelector("button[type=submit]:not(:disabled), button:not(:disabled)")?.focus();
  return true;
}

function clearCurrent(target) {
  if (target.type === "checkbox" || target.type === "radio") return;
  const setter = Object.getOwnPropertyDescriptor(target.constructor.prototype, "value")?.set;
  if (setter) setter.call(target, "");
  else target.value = "";
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
}

export function handleFormKeyboard(event) {
  const target = event.target;
  if (target?.matches?.("nav a:not([href])")) {
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); target.click(); }
    return;
  }
  const form = target?.form || target?.closest?.("form");
  if (!form) return;

  if ((event.altKey || event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    form.requestSubmit?.();
    event.stopPropagation();
    return;
  }
  if (!isEditable(target)) return;
  if (target.matches("[role=combobox]")) return;
  if (event.ctrlKey || event.metaKey || event.key === "Tab") return;

  if (event.key === "Escape") {
    event.preventDefault();
    clearCurrent(target);
    return;
  }

  if (event.key === "Backspace" && !target.value && !target.isContentEditable) {
    event.preventDefault();
    focusNext(target, true);
    return;
  }

  if (event.key === "Enter") {
    if (target.tagName === "TEXTAREA" && event.shiftKey) return;
    if (target.type === "checkbox") {
      event.preventDefault();
      target.click();
      return;
    }
    if (target.type === "radio") event.preventDefault();
    else event.preventDefault();
    focusNext(target);
  }
}

export default function useFormKeyboardNavigation() {
  useEffect(() => {
    document.addEventListener("keydown", handleFormKeyboard, true);
    const makeNavLinksFocusable = () => document.querySelectorAll("nav a:not([href])").forEach(link => { if (!link.hasAttribute("tabindex")) link.tabIndex = 0; });
    makeNavLinksFocusable();
    const observer = new MutationObserver(makeNavLinksFocusable);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); document.removeEventListener("keydown", handleFormKeyboard, true); };
  }, []);
}
