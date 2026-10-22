import test from "node:test";
import assert from "node:assert/strict";
import { previewBox, previewWidth } from "./previewLayout.js";
test("viewport sizing leaves minimal padding and caps the modal at 95vw", () => {
  for (const width of [360,768,1440]) {
    const box=previewBox(width,900,70,8);
    assert.equal(box.w,width*.95-16);
    assert.equal(box.h,900*.95-70-16);
    assert.ok(previewWidth(1200,1.5,width,8)<=width*.95);
  }
  assert.equal(previewWidth(200,1.5,1440,8),316);
  assert.equal(previewWidth(200,2,1440,8),416);
});
