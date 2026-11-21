import assert from "node:assert/strict";
import test from "node:test";
import { createDesklineStore } from "../src/lib/deskline.ts";

const bearer = (token) => `Bearer ${token}`;

test("the invite is one-time and viewer and host capabilities cannot be swapped", () => {
  const store = createDesklineStore();
  const host = store.invite();
  const viewer = store.join(host.code);
  assert.match(host.code, /^[A-F0-9]{12}$/);
  assert.match(viewer.verification, /^[0-9]{6}$/);
  assert.notEqual(host.token, viewer.token);
  assert.equal(store.join(host.code), undefined);
  assert.equal(store.authenticate(bearer(viewer.token), "host"), undefined);
  assert.equal(store.authenticate(bearer(host.token), "viewer"), undefined);
});

test("only an approved session accepts frames and current input; end clears both", () => {
  let now = 1_000_000;
  const store = createDesklineStore(() => now);
  const host = store.invite();
  const s = store.authenticate(bearer(host.token), "host");
  const jpeg = Buffer.from([255, 216, 255, 217]);
  assert.equal(store.approve(s), false);
  const viewer = store.join(host.code);
  assert.equal(store.tick(s, jpeg).state, "pending");
  assert.equal(s.frame, undefined);
  assert.equal(store.approve(s), true);
  store.enqueue(s, {kind:"down", button:0, x:0.5, y:0.6});
  store.enqueue(s, {kind:"move", x:0.5, y:0.5});
  store.enqueue(s, {kind:"move", x:0.8, y:0.8});
  assert.equal(store.tick(s, jpeg).input.length, 2);
  assert.equal(s.sequence, 1);
  assert.deepEqual(s.frame, jpeg);
  store.enqueue(s, {kind:"up", button:0, x:0.5, y:0.6});
  now += 1001;
  assert.deepEqual(store.tick(s).input, [{kind:"release"}]);
  store.end(s);
  assert.equal(s.frame, undefined);
  assert.equal(store.authenticate(bearer(host.token)), undefined);
  assert.equal(store.authenticate(bearer(viewer.token)), undefined);
});

test("peer timeouts invalidate an approved session even if the other peer is online", () => {
  let now = 1_000_000;
  const store = createDesklineStore(() => now);
  const host = store.invite();
  const s = store.authenticate(bearer(host.token), "host");
  const viewer = store.join(host.code);
  assert.equal(store.approve(s), true);
  now += 15_000;
  assert.equal(store.authenticate(bearer(host.token), "host"), s);
  now += 6_000;
  store.sweep();
  assert.equal(store.authenticate(bearer(viewer.token)), undefined);
  assert.equal(store.authenticate(bearer(host.token)), undefined);
});

test("waiting invites expire even with a host still polling", () => {
  let now = 1_000_000;
  const store = createDesklineStore(() => now);
  const host = store.invite();
  for (let i=0; i<12; i++) {
    now += 15_000;
    store.authenticate(bearer(host.token), "host");
  }
  assert.equal(store.join(host.code), undefined);
});
