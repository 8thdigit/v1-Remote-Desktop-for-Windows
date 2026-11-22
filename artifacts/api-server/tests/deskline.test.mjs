import assert from "node:assert/strict";
import test from "node:test";
import { createDesklineStore, standingCode } from "../src/lib/deskline.ts";

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

test("an unattended host's derived code joins straight to live and only its key can claim it", () => {
  let now = 1_000_000;
  const store = createDesklineStore(() => now);
  const key = "A".repeat(43);
  const first = store.standing(key);
  assert.match(first.code, /^[A-F0-9]{12}$/);
  assert.equal(first.code, standingCode(key));
  assert.notEqual(standingCode("B".repeat(43)), first.code);
  assert.equal(store.standing("short"), undefined);
  // Re-registering with the same key replaces the waiting session.
  const host = store.standing(key);
  assert.equal(host.code, first.code);
  assert.equal(store.authenticate(bearer(first.token), "host"), undefined);
  const s = store.authenticate(bearer(host.token), "host");
  const viewer = store.join(host.code);
  assert.equal(viewer.preapproved, true);
  assert.equal(viewer.verification, "");
  assert.equal(s.state, "live");
  assert.equal(store.approve(s), false);
  const jpeg = Buffer.from([255, 216, 255, 217]);
  assert.equal(store.tick(s, jpeg).state, "live");
  assert.deepEqual(s.frame, jpeg);
  assert.equal(store.join(host.code), undefined);
  // An attended invite still needs approval.
  const attended = store.invite();
  const attendedViewer = store.join(attended.code);
  assert.equal(attendedViewer.preapproved, false);
  assert.equal(store.authenticate(bearer(attended.token), "host").state, "pending");
});

test("an unattended host's Initiate request is visible only to viewers that know its code, until accepted or expired", () => {
  let now = 1_000_000;
  const store = createDesklineStore(() => now);
  const key = "C".repeat(43);
  const host = store.standing(key);
  const s = store.authenticate(bearer(host.token), "host");
  const other = store.standing("D".repeat(43));
  assert.deepEqual(store.calls([host.code, other.code]), []);
  assert.equal(store.call(s, "FRONT-DESK<script>"), true);
  assert.deepEqual(store.calls([other.code]), []);
  assert.deepEqual(store.calls([host.code, other.code]), [{code: host.code, name: "FRONT-DESKscript"}]);
  // Attended invites cannot initiate.
  const attended = store.invite();
  assert.equal(store.call(store.authenticate(bearer(attended.token), "host"), "x"), false);
  // Accepting is joining: it goes live at once and clears the request.
  const viewer = store.join(host.code);
  assert.equal(viewer.preapproved, true);
  assert.equal(s.state, "live");
  assert.deepEqual(store.calls([host.code]), []);
  assert.equal(store.call(s, "again"), false);
  // A request expires after two minutes.
  const second = store.standing("E".repeat(43));
  store.call(store.authenticate(bearer(second.token), "host"), "pc");
  const heartbeat = (ms) => { for (let t = 0; t < ms; t += 10_000) { now += 10_000; store.authenticate(bearer(second.token), "host"); } };
  heartbeat(110_000);
  assert.equal(store.calls([second.code]).length, 1);
  heartbeat(20_000);
  assert.deepEqual(store.calls([second.code]), []);
});

test("presence reports online and busy unattended PCs only to viewers that know the code", () => {
  let now = 1_000_000;
  const store = createDesklineStore(() => now);
  const host = store.standing("F".repeat(43), "RECEPTION-PC<b>");
  const other = store.standing("G".repeat(43));
  const missing = standingCode("H".repeat(43));
  assert.deepEqual(store.presence([host.code, missing]), [{code: host.code, name: "RECEPTION-PCb", state: "online"}]);
  // Initiate falls back to the registered name.
  const s = store.authenticate(bearer(host.token), "host");
  store.call(s, "");
  assert.deepEqual(store.calls([host.code]), [{code: host.code, name: "RECEPTION-PCb"}]);
  // A live session is busy, then gone after it ends.
  store.join(host.code);
  assert.deepEqual(store.presence([host.code]), [{code: host.code, name: "RECEPTION-PCb", state: "busy"}]);
  store.end(s);
  assert.deepEqual(store.presence([host.code]), []);
  // A host that stops refreshing goes offline.
  now += 25_000;
  assert.deepEqual(store.presence([other.code]), []);
  // Attended invites never show presence.
  const attended = store.invite();
  assert.deepEqual(store.presence([attended.code]), []);
});

const op = (raId, id = "u" + raId) => ({id, name: "Tech " + raId, raId});

test("a request sent to an RA ID reaches only that RA user, who accepts it without the access code", () => {
  let now = 1_000_000;
  const store = createDesklineStore(() => now);
  const host = store.standing("J".repeat(43), "SHOP-PC");
  const s = store.authenticate(bearer(host.token), "host");
  assert.equal(store.call(s, "", undefined, "123456"), true);
  const inbox = store.inbox("123456");
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].status, "waiting");
  assert.equal(inbox[0].name, "SHOP-PC");
  assert.equal("code" in inbox[0], false);
  assert.deepEqual(store.inbox("654321"), []);
  // Someone else cannot accept it, even with the request id.
  assert.equal(store.accept(inbox[0].id, op("654321")).error, "missing");
  // Re-registering (every two minutes) and repeating the call keeps one request.
  const again = store.standing("J".repeat(43), "SHOP-PC");
  const s2 = store.authenticate(bearer(again.token), "host");
  store.call(s2, "", undefined, "123456");
  assert.equal(store.inbox("123456").length, 1);
  const {viewer} = store.accept(inbox[0].id, op("123456"));
  assert.equal(viewer.preapproved, true);
  assert.equal(s2.state, "live");
  assert.equal(s2.operator.raId, "123456");
  const after = store.inbox("123456")[0];
  assert.equal(after.status, "accepted");
  assert.equal(after.acceptedBy.raId, "123456");
  assert.equal(store.accept(inbox[0].id, op("123456")).error, "accepted");
  assert.equal(store.overview().live.length, 1);
});

test("an attended host can send its request to an RA ID, which still needs the verification number", () => {
  let now = 1_000_000;
  const store = createDesklineStore(() => now);
  const host = store.invite();
  const s = store.authenticate(bearer(host.token), "host");
  assert.equal(store.call(s, "LAPTOP", undefined, "111111"), true);
  const [r] = store.inbox("111111");
  assert.equal(r.mode, "attended");
  const {viewer} = store.accept(r.id, op("111111"));
  assert.equal(viewer.preapproved, false);
  assert.match(viewer.verification, /^[0-9]{6}$/);
  assert.equal(s.state, "pending");
});

test("unanswered RA requests become missed when they time out or the PC leaves", () => {
  let now = 1_000_000;
  const store = createDesklineStore(() => now);
  const host = store.standing("K".repeat(43));
  const s = store.authenticate(bearer(host.token), "host");
  store.call(s, "pc", undefined, "222222");
  now += 121_000;
  store.authenticate(bearer(host.token), "host");
  assert.equal(store.inbox("222222")[0].status, "missed");
  const second = store.standing("L".repeat(43));
  store.call(store.authenticate(bearer(second.token), "host"), "pc2", undefined, "222222");
  store.end(store.authenticate(bearer(second.token), "host"));
  assert.equal(store.inbox("222222")[0].status, "missed");
});

test("frames and input wake long polls; admin can end a session by id", async () => {
  const store = createDesklineStore();
  const host = store.standing("M".repeat(43));
  const s = store.authenticate(bearer(host.token), "host");
  store.join(host.code, op("333333"));
  const jpeg = Buffer.from([255, 216, 255, 217]);
  const started = Date.now();
  const waiting = store.waitFrame(s, 0, 5000);
  setTimeout(() => store.tick(s, jpeg, true), 20);
  await waiting;
  assert.ok(Date.now() - started < 1000);
  assert.equal(s.sequence, 1);
  const pulled = store.pull(s, 5000);
  setTimeout(() => store.enqueue(s, {kind: "key", key: "a"}), 20);
  assert.deepEqual((await pulled).input, [{kind: "key", key: "a"}]);
  // A pulling host does not also get input with its tick.
  store.enqueue(s, {kind: "key", key: "b"});
  assert.deepEqual(store.tick(s).input, []);
  assert.equal((await store.pull(s, 10)).input.length, 1);
  const [live] = store.overview().live;
  assert.equal(store.endById(live.id), true);
  assert.equal(store.authenticate(bearer(host.token)), undefined);
});

test("a live session stays open past 30 minutes while both peers poll", () => {
  let now = 1_000_000;
  const store = createDesklineStore(() => now);
  const host = store.standing("N".repeat(43));
  const viewer = store.join(host.code, op("444444"));
  for (let i = 0; i < 400; i++) {
    now += 10_000;
    assert.ok(store.authenticate(bearer(host.token), "host"));
    assert.ok(store.authenticate(bearer(viewer.token), "viewer"));
  }
});
