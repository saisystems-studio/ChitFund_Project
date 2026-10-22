import test from "node:test";
import assert from "node:assert/strict";
import { detailPath, parseDetailRoute, rowDetail } from "./reportDetailRoute.js";

globalThis.window = { location: { pathname: "/chitfund/reports/customer" }, getSelection: () => null };

test("route round-trips kind, id and params", () => {
  const path = detailPath("group", "group-4", { report: "trial-balance", from: "2026-04-01", to: "" });
  assert.deepEqual(parseDetailRoute(path), { kind: "group", id: "group-4", params: { report: "trial-balance", from: "2026-04-01" } });
  assert.equal(parseDetailRoute("/reports/customer"), null);
});

test("opens only on double-click, never from an inner button, and not twice", () => {
  const calls = [];
  const props = rowDetail(path => calls.push(path), "loan", 7);
  assert.equal(props.onClick, undefined);
  props.onDoubleClick({ target: { closest: () => ({}) } });
  assert.equal(calls.length, 0);
  props.onDoubleClick({ target: { closest: () => null } });
  props.onDoubleClick({ target: { closest: () => null } });
  assert.deepEqual(calls, ["/report-detail/loan/7"]);
});

test("no id, no handler", () => assert.deepEqual(rowDetail(() => {}, "loan", ""), {}));
