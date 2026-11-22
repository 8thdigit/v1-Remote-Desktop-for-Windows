import assert from "node:assert/strict";
import test from "node:test";
import { createMsfwrStore, standingCode } from "../src/lib/msfwr.ts";

const bearer = (token) => `Bearer ${token}`;

test("the invite is one-time and viewer and host capabilities cannot be swapped", () => {
  const store = createMsfwrStore();
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
  const store = createMsfwrStore(() => now);
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
  const store = createMsfwrStore(() => now);
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
  const store = createMsfwrStore(() => now);
  const host = store.invite();
  for (let i=0; i<12; i++) {
    now += 15_000;
    store.authenticate(bearer(host.token), "host");
  }
  assert.equal(store.join(host.code), undefined);
});

test("an unattended host's derived code joins straight to live and only its key can claim it", () => {
  let now = 1_000_000;
  const store = createMsfwrStore(() => now);
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
  const store = createMsfwrStore(() => now);
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
  const store = createMsfwrStore(() => now);
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

const key = (c) => c.repeat(43);
const op = (raId, id = "u1") => ({id, name: "Acme Ltd", raId});

test("a PC pointed at an RA ID shows up for that company, which can connect without the access code", () => {
  let now = 5_000_000;
  const store = createMsfwrStore(() => now);
  const host = store.standing(key("a"), "PC-ONE", "123456");
  store.standing(key("b"), "PC-OTHER", "654321");
  const mine = store.inbox("123456");
  assert.deepEqual(mine.pcs.map((p) => [p.name, p.state]), [["PC-ONE", "online"]]);
  assert.ok(!JSON.stringify(mine).includes(host.code), "the access code never reaches the portal");
  assert.equal(store.connectPc(mine.pcs[0].id, op("654321")), undefined, "another company cannot use the id");
  const viewer = store.connectPc(mine.pcs[0].id, op("123456"));
  assert.equal(viewer.preapproved, true);
  assert.equal(store.inbox("123456").pcs[0].state, "busy");
});

test("Initiate with an RA ID reaches that company's inbox only, and accepting it goes live", () => {
  let now = 6_000_000;
  const store = createMsfwrStore(() => now);
  const host = store.standing(key("c"), "FRONT-DESK", "111111");
  const s = store.authenticate(bearer(host.token), "host");
  assert.equal(store.call(s, "FRONT-DESK"), true);
  const inbox = store.inbox("111111");
  assert.equal(inbox.requests.length, 1);
  assert.equal(inbox.requests[0].status, "waiting");
  assert.equal(inbox.requests[0].code, undefined);
  assert.equal(store.inbox("222222").requests.length, 0);
  assert.deepEqual(store.accept(inbox.requests[0].id, op("222222")), {error: "missing"});
  const { viewer } = store.accept(inbox.requests[0].id, op("111111"));
  assert.equal(viewer.preapproved, true);
  assert.equal(store.tick(s).state, "live");
  const after = store.inbox("111111").requests[0];
  assert.equal(after.status, "accepted");
  assert.equal(after.acceptedBy, "Acme Ltd");
  assert.deepEqual(store.accept(after.id, op("111111")), {error: "accepted"});
});

test("an unanswered request is marked missed after two minutes", () => {
  let now = 7_000_000;
  const store = createMsfwrStore(() => now);
  const host = store.standing(key("d"), "PC", "333333");
  const s = store.authenticate(bearer(host.token), "host");
  store.call(s, "PC");
  now += 2 * 60_000 + 1;
  store.authenticate(bearer(host.token), "host");
  assert.equal(store.inbox("333333").requests[0].status, "missed");
});

test("a remote access link needs its access code, connects to the PC that made it, and stops when cleared", () => {
  let now = 8_000_000;
  const store = createMsfwrStore(() => now);
  const host = store.standing(key("e"), "LAPTOP", undefined);
  const link = store.linkCreate(key("e"), "LAPTOP", 4);
  assert.match(link.code, /^L[0-9A-F]{11}$/);
  assert.match(link.pin, /^\d{6}$/);
  assert.equal(link.expiresAt - link.createdAt, 4 * 3_600_000);
  assert.equal(link.key, undefined);
  const info = store.linkInfo(link.code.toLowerCase());
  assert.deepEqual([info.name, info.online, info.busy], ["LAPTOP", true, false]);
  const wrong = link.pin === "000000" ? "000001" : "000000";
  assert.deepEqual(store.linkJoin(link.code, wrong), {error: "pin"});
  const ok = store.linkJoin(link.code, link.pin);
  assert.equal(ok.viewer.preapproved, true);
  const s = store.authenticate(bearer(host.token), "host");
  assert.equal(store.tick(s).state, "live");
  const second = store.linkJoin(link.code, link.pin);
  assert.ok(second.viewer, "a second person joins the same session through the URL");
  assert.equal(store.linkInfo(link.code).viewers, 2);
  assert.equal(store.linkStatus(link.id, key("e")).link.sessions, 2);
  assert.equal(store.authenticate(bearer(ok.viewer.token), "viewer"), s);
  assert.equal(store.authenticate(bearer(second.viewer.token), "viewer"), s);
  // One person leaving keeps the session open for the other.
  assert.equal(store.leave(s, bearer(ok.viewer.token)), false);
  assert.equal(store.authenticate(bearer(ok.viewer.token), "viewer"), undefined);
  assert.equal(store.tick(store.authenticate(bearer(host.token), "host")).state, "live");
  assert.equal(store.leave(s, bearer(second.viewer.token)), true, "the last one leaving ends it");
  assert.equal(store.authenticate(bearer(host.token), "host"), undefined);
  assert.equal(store.linkRevoke(link.id, key("f")), false, "only the PC's key can clear it");
  assert.equal(store.linkRevoke(link.id, key("e")), true);
  assert.equal(store.linkInfo(link.code), undefined);
  assert.deepEqual(store.linkJoin(link.code, link.pin), {error: "missing"});
});

test("linkHostRa returns the RA ID of the PC behind a link, for subscription gating", () => {
  let now = 8_500_000;
  const store = createMsfwrStore(() => now);
  store.standing(key("r"), "KIOSK", "246810");
  const link = store.linkCreate(key("r"), "KIOSK", 4);
  assert.equal(store.linkHostRa(link.code), "246810", "the link resolves to its PC's RA ID");
  assert.equal(store.linkHostRa(link.code.toLowerCase()), "246810", "codes are case-insensitive");
  assert.equal(store.linkHostRa("LDEADBEEF01"), undefined, "an unknown code resolves to nothing");
});

test("a link locks after repeated wrong access codes and expires on time", () => {
  let now = 9_000_000;
  const store = createMsfwrStore(() => now);
  store.standing(key("g"), "PC");
  const link = store.linkCreate(key("g"), "PC", 1);
  const wrong = link.pin === "000000" ? "000001" : "000000";
  for (let i = 0; i < 8; i++) store.linkJoin(link.code, wrong);
  assert.deepEqual(store.linkJoin(link.code, link.pin), {error: "locked"});
  now += 15 * 60_000 + 1;
  store.standing(key("g"), "PC");
  assert.ok(store.linkJoin(link.code, link.pin).viewer);
  now += 60 * 60_000;
  assert.equal(store.linkInfo(link.code), undefined);
});

test("only the PC that owns a link can restore it after a relay restart", () => {
  const first = createMsfwrStore(() => 10_000_000);
  const link = first.linkCreate(key("h"), "PC", 24);
  const second = createMsfwrStore(() => 10_000_000 + 60_000);
  const saved = {id: link.id, key: key("h"), pin: link.pin, name: "PC", createdAt: link.createdAt, expiresAt: link.expiresAt};
  const thief = second.linkRestore({...saved, key: key("i")});
  assert.notEqual(thief.code, link.code, "another key gets a different public code");
  const restored = second.linkRestore(saved);
  assert.equal(restored.code, link.code);
  assert.equal(restored.pin, link.pin);
  const third = createMsfwrStore(() => 10_000_000 + 60_000);
  assert.equal(third.linkRestore({...saved, expiresAt: 10_000_000}), undefined, "expired links are not restored");
});

test("up to ten people share one URL session; a company session is not joinable through the URL", () => {
  let now = 9_500_000;
  const store = createMsfwrStore(() => now);
  store.standing(key("m"), "OFFICE");
  const link = store.linkCreate(key("m"), "OFFICE", 2);
  for (let i = 0; i < 10; i++) assert.ok(store.linkJoin(link.code, link.pin).viewer);
  assert.deepEqual(store.linkJoin(link.code, link.pin), {error: "full"});
  assert.equal(store.linkInfo(link.code).busy, true);

  const host = store.standing(key("n"), "DESK", "424242");
  const link2 = store.linkCreate(key("n"), "DESK", 2);
  assert.ok(store.connectPc(store.inbox("424242").pcs[0].id, {id: "u1", name: "Acme", raId: "424242"}));
  assert.ok(store.authenticate(bearer(host.token), "host"));
  assert.deepEqual(store.linkJoin(link2.code, link2.pin), {error: "busy"});

  // Viewers that stop polling drop out; the session ends when none are left.
  const s3 = store.standing(key("o"), "KIOSK");
  const link3 = store.linkCreate(key("o"), "KIOSK", 2);
  const a = store.linkJoin(link3.code, link3.pin).viewer;
  now += 10_000;
  assert.ok(store.authenticate(bearer(s3.token), "host"));
  const b = store.linkJoin(link3.code, link3.pin).viewer;
  now += 15_000;
  assert.ok(store.authenticate(bearer(s3.token), "host"));
  assert.ok(store.authenticate(bearer(b.token), "viewer"));
  assert.equal(store.authenticate(bearer(a.token), "viewer"), undefined, "a silent viewer times out");
});

test("live-start fires onLive once and end records the ended session once", () => {
  let now = 1_000_000;
  const live = [];
  const ended = [];
  const store = createMsfwrStore(() => now, {
    onLive: (s) => live.push(s.ra),
    onEnd: (e) => ended.push(e),
  });
  const key = "k".repeat(43);
  const reg = store.standing(key, "Reception PC", "123456");
  const viewer = store.join(reg.code, { id: "op1", name: "Acme IT", raId: "123456" });
  assert.ok(viewer.preapproved);
  assert.deepEqual(live, ["123456"], "onLive fired once with the RA ID");
  const host = store.authenticate(bearer(reg.token), "host");
  now += 125_000;
  store.end(host);
  assert.equal(ended.length, 1, "onEnd fired exactly once");
  assert.equal(ended[0].raId, "123456");
  assert.equal(ended[0].mode, "unattended");
  assert.equal(ended[0].operator, "Acme IT");
  assert.equal(ended[0].durationMs, 125_000);
  assert.equal(ended[0].viewers, 1);
  // A second end() must not record again.
  store.end(host);
  assert.equal(ended.length, 1, "ended session is recorded only once");
});

test("a waiting registration that never goes live is not recorded", () => {
  let now = 1_000_000;
  const live = [];
  const ended = [];
  const store = createMsfwrStore(() => now, { onLive: (s) => live.push(s), onEnd: (e) => ended.push(e) });
  const key = "k".repeat(43);
  const reg = store.standing(key, "PC", "123456");
  const host = store.authenticate(bearer(reg.token), "host");
  now += 25_000; // host stops polling
  store.sweep();
  assert.equal(live.length, 0);
  assert.equal(ended.length, 0, "a session that never went live is not in history");
});
