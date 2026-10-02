import test from "node:test";
import assert from "node:assert/strict";
import { completeEntryOutput } from "./entryOutput.js";

test("PDF navigation waits for successful output", async () => {
  const events = [];
  await completeEntryOutput(async () => { events.push("saved"); }, "pdf", "", () => events.push("list"));
  assert.deepEqual(events, ["saved", "list"]);
  await assert.rejects(completeEntryOutput(async () => { throw Error("PDF failed"); }, "pdf", "", () => events.push("wrong redirect")));
  assert.deepEqual(events, ["saved", "list"]);
});

test("print navigation waits until after the existing dialog closes", async () => {
  const events = [];
  const printWindow = new EventTarget();
  printWindow.focus = () => {};
  printWindow.print = () => events.push("print opened");
  const frame = { contentWindow: printWindow };
  const previousDocument = globalThis.document;
  globalThis.document = { querySelector: () => frame };
  try {
    const complete = completeEntryOutput(async () => {}, "print", "receipt-print-frame", () => events.push("list"));
    await Promise.resolve();
    assert.deepEqual(events, []);
    frame.onload(new Event("load"));
    assert.deepEqual(events, ["print opened"]);
    printWindow.dispatchEvent(new Event("afterprint"));
    await complete;
    printWindow.dispatchEvent(new Event("afterprint"));
    assert.deepEqual(events, ["print opened", "list"]);
  } finally { globalThis.document = previousDocument; }
});

test("a blocked fallback rejects instead of keeping the saved entry busy", async () => {
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  const frame = { src: "blob:receipt", contentWindow: { addEventListener() {}, focus() { throw Error("Cannot print iframe"); } } };
  globalThis.document = { querySelector: () => frame };
  globalThis.window = { open: () => null };
  try {
    let redirected = false;
    const complete = completeEntryOutput(async () => {}, "print", "receipt-print-frame", () => { redirected = true; });
    await Promise.resolve();
    frame.onload();
    await assert.rejects(complete, /blocked/);
    assert.equal(redirected, false);
  } finally { globalThis.document = previousDocument; globalThis.window = previousWindow; }
});

test("a fallback preview completes when its tab is closed", async () => {
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  const popup = new EventTarget();
  popup.closed = false;
  const frame = { src: "blob:receipt", contentWindow: { addEventListener() {}, focus() { throw Error("Cannot print iframe"); } } };
  globalThis.document = { querySelector: () => frame };
  globalThis.window = { open: () => popup };
  try {
    let redirected = false;
    const complete = completeEntryOutput(async () => {}, "print", "receipt-print-frame", () => { redirected = true; });
    await Promise.resolve();
    frame.onload();
    assert.equal(redirected, false);
    popup.closed = true;
    await complete;
    assert.equal(redirected, true);
  } finally { globalThis.document = previousDocument; globalThis.window = previousWindow; }
});
