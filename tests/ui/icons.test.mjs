import test from "node:test";
import assert from "node:assert/strict";
import { statusIcon } from "../../internal/httpapi/ui/icons.mjs";

// ADR 0002: an abnormal state carries a shape besides colour and text. The badge text
// already says the state, so the shape is hidden from assistive technology.
test("abnormal states get a hidden icon and normal states stay quiet", () => {
  for (const state of [
    "stale",
    "warning",
    "error",
    "skipped",
    "network",
    "critical",
  ]) {
    assert.match(
      statusIcon(state),
      /^<svg class="icon" .*aria-hidden="true">.+<\/svg>$/s,
      state,
    );
  }
  for (const state of ["ok", "recorded", "empty", "info", "", "__proto__"]) {
    assert.equal(statusIcon(state), "", state);
  }
  assert.equal(statusIcon(undefined), "");
});

test("attention, network and critical use different shapes", () => {
  const shapes = new Set(["warning", "network", "critical"].map(statusIcon));
  assert.equal(shapes.size, 3);
  assert.equal(statusIcon("stale"), statusIcon("skipped"));
  assert.equal(statusIcon("error"), statusIcon("warning"));
});
