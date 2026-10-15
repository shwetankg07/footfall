// node utils/funnel.check.js — the order rules the funnel numbers depend on.
import assert from "node:assert/strict";
import { stepsReached, funnelResult } from "./funnel.js";

const steps = [
  { kind: "page", value: "/" },
  { kind: "page", value: "/product/*" },
  { kind: "event", value: "paid" },
];
const pv = (path) => ({ name: "pageview", path });
const ev = (name) => ({ name, path: "/checkout" });

assert.equal(stepsReached(steps, [pv("/"), pv("/product/keyboard"), ev("paid")]), 3);
assert.equal(stepsReached(steps, [pv("/product/keyboard"), pv("/"), ev("paid")]), 1, "out of order only counts the first step");
assert.equal(stepsReached(steps, [pv("/"), pv("/products"), ev("paid")]), 1, "/products is not under /product/");
assert.equal(stepsReached(steps, [ev("paid")]), 0);
assert.equal(stepsReached(steps, [pv("/"), pv("/"), pv("/product/a"), pv("/product/b")]), 2, "repeats don't double count");

const result = funnelResult(steps, [
  [pv("/"), pv("/product/a"), ev("paid")],
  [pv("/"), pv("/product/a")],
  [pv("/")],
  [pv("/")],
]);
assert.deepEqual(result.map((step) => step.visitors), [4, 2, 1]);
assert.deepEqual(result.map((step) => step.kept), [null, 50, 50]);
assert.deepEqual(result.map((step) => step.ofStart), [100, 50, 25]);
assert.deepEqual(funnelResult(steps, []).map((step) => step.kept), [null, 0, 0]);

console.log("funnel checks passed");
