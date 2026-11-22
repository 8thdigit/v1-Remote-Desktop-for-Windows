import assert from "node:assert/strict";
import test from "node:test";
import { keyedLimiter } from "../src/lib/security.ts";

test("keyedLimiter blocks a key past the max within the window, independently per key", () => {
  let now = 1_000;
  const lim = keyedLimiter(3, 1000);
  const t = () => now;
  assert.equal(lim.hit("a", t()), false);
  assert.equal(lim.hit("a", t()), false);
  assert.equal(lim.hit("a", t()), false);
  assert.equal(lim.hit("a", t()), true, "4th hit is over the max of 3");
  assert.equal(lim.blocked("a", t()), true);
  assert.equal(lim.blocked("b", t()), false, "a different key is unaffected");
  // The window resets.
  now += 1001;
  assert.equal(lim.hit("a", t()), false);
  assert.equal(lim.blocked("a", t()), false);
});

test("keyedLimiter reset clears a key", () => {
  const lim = keyedLimiter(1, 10_000);
  lim.hit("a"); lim.hit("a");
  assert.equal(lim.blocked("a"), true);
  lim.reset("a");
  assert.equal(lim.blocked("a"), false);
});
