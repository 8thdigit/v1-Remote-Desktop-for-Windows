// End-to-end test of the built relay (dist/index.mjs): accounts, the admin
// API, RA ID routing of Initiate requests, and remote access links.
// Run after `pnpm --filter @workspace/api-server run build`:
//   node --test artifacts/api-server/tests/e2e.test.mjs
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const port = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}/api`;
const dataDir = mkdtempSync(path.join(tmpdir(), "msfwr-e2e-"));
let server;

before(async () => {
  server = spawn(process.execPath, [path.join(here, "..", "dist", "index.mjs")], {
    env: { ...process.env, PORT: String(port), MSFWR_DATA_DIR: dataDir, ADMIN_USERNAME: "root", ADMIN_PASSWORD: "admin-pass-123", NODE_ENV: "production", DATABASE_URL: "" },
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("relay did not start");
});
after(() => { server?.kill(); rmSync(dataDir, { recursive: true, force: true }); });

// A tiny cookie-keeping client, like one browser.
function client(root = base) {
  let cookie = "";
  return async function call(method, route, body, headers = {}) {
    const res = await fetch(root + route, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    const text = await res.text();
    let json;
    try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
    return { status: res.status, json };
  };
}

const pcKey = (c) => c.repeat(43);

test("admin signs in, creates a company with a login ID and RA ID, and the company signs in", async () => {
  const admin = client();
  assert.equal((await admin("GET", "/auth/status")).json.user, undefined);
  assert.equal((await admin("POST", "/auth/login", { username: "root", password: "wrong-password" })).status, 401);
  const me = await admin("POST", "/auth/login", { username: "root", password: "admin-pass-123" });
  assert.equal(me.status, 200);
  assert.equal(me.json.role, "admin");
  assert.equal(me.json.mustChangePassword, false, "an ADMIN_PASSWORD admin is not asked to change it");

  const created = await admin("POST", "/admin/users", { username: "acme", displayName: "Acme Ltd", password: "acme-temp-123", role: "company", raId: "RA-424242" });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  assert.equal(created.json.raId, "424242");
  assert.equal((await admin("POST", "/admin/users", { username: "other", password: "other-pass-123", role: "company", raId: "424242" })).status, 409, "RA IDs are unique");
  const generated = await admin("POST", "/admin/users", { username: "globex", displayName: "Globex", password: "globex-pass-123", role: "company" });
  assert.match(generated.json.raId, /^\d{6}$/);
  assert.equal((await admin("GET", "/admin/users")).json.users.length, 3);

  const acme = client();
  const first = await acme("POST", "/auth/login", { username: "ACME", password: "acme-temp-123" });
  assert.equal(first.status, 200);
  assert.equal(first.json.mustChangePassword, true, "an admin-set password is temporary");
  assert.equal((await acme("GET", "/msfwr/inbox")).status, 403, "nothing opens before choosing a password");
  assert.equal((await acme("POST", "/auth/password", { current: "acme-temp-123", next: "acme-temp-123" })).status, 400);
  assert.equal((await acme("POST", "/auth/password", { current: "acme-temp-123", next: "acme-pass-123" })).status, 204);
  assert.equal((await acme("GET", "/auth/status")).json.user.mustChangePassword, false);
  assert.equal((await acme("GET", "/admin/users")).status, 403, "companies cannot use the admin console");
  const inbox = await acme("GET", "/msfwr/inbox");
  assert.deepEqual([inbox.json.raId, inbox.json.company, inbox.json.pcs.length], ["424242", "Acme Ltd", 0]);

  // Disabling a company signs it out everywhere.
  await admin("PATCH", `/admin/users/${generated.json.id}`, { disabled: true });
  const globex = client();
  assert.equal((await globex("POST", "/auth/login", { username: "globex", password: "globex-pass-123" })).status, 403);
  assert.equal((await admin("DELETE", `/admin/users/${generated.json.id}`)).status, 204);
});

test("viewer endpoints need a sign-in", async () => {
  const anon = client();
  assert.equal((await anon("POST", "/msfwr/join", { code: "ABCDEFABCDEF" })).status, 401);
  assert.equal((await anon("POST", "/msfwr/calls", { codes: [] })).status, 401);
  assert.equal((await anon("GET", "/msfwr/inbox")).status, 401);
});

test("a PC pointed at the company's RA ID: Initiate reaches only that company, which accepts and goes live", async () => {
  const pc = client();
  const reg = await pc("POST", "/msfwr/standing", { key: pcKey("p"), name: "RECEPTION-PC", ra: "RA-424242" });
  assert.equal(reg.status, 201);
  assert.deepEqual([reg.json.raStatus, reg.json.raName], ["ok", "Acme Ltd"]);
  const bad = await client()("POST", "/msfwr/standing", { key: pcKey("q"), name: "X", ra: "999999" });
  assert.equal(bad.json.raStatus, "unknown");

  const host = { authorization: `Bearer ${reg.json.token}` };
  assert.equal((await pc("POST", "/msfwr/call", { name: "RECEPTION-PC" }, host)).status, 204);

  const acme = client();
  await acme("POST", "/auth/login", { username: "acme", password: "acme-pass-123" });
  const inbox = (await acme("GET", "/msfwr/inbox")).json;
  assert.equal(inbox.pcs.length, 1);
  assert.equal(inbox.pcs[0].name, "RECEPTION-PC");
  assert.equal(inbox.requests[0].status, "waiting");
  assert.ok(!JSON.stringify(inbox).includes(reg.json.code), "the company never sees the access code");

  const admin = client();
  await admin("POST", "/auth/login", { username: "root", password: "admin-pass-123" });
  await admin("POST", "/admin/users", { username: "rival", password: "rival-temp-123", role: "company", raId: "515151" });
  const rival = client();
  await rival("POST", "/auth/login", { username: "rival", password: "rival-temp-123" });
  await rival("POST", "/auth/password", { current: "rival-temp-123", next: "rival-pass-123" });
  assert.equal((await rival("GET", "/msfwr/inbox")).json.requests.length, 0);
  assert.equal((await rival("POST", "/msfwr/accept", { id: inbox.requests[0].id })).status, 404);

  const accepted = await acme("POST", "/msfwr/accept", { id: inbox.requests[0].id });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.json.preapproved, true);
  const tick = await pc("POST", "/msfwr/tick", undefined, host);
  assert.equal(tick.json.state, "live");
  const viewer = { authorization: `Bearer ${accepted.json.token}` };
  assert.equal((await acme("POST", "/msfwr/input", { kind: "move", x: 0.5, y: 0.5 }, viewer)).status, 204);
  assert.deepEqual((await pc("POST", "/msfwr/tick", undefined, host)).json.input, [{ kind: "move", x: 0.5, y: 0.5 }]);

  const overview = (await admin("GET", "/admin/overview")).json;
  assert.equal(overview.live.length, 1);
  assert.equal(overview.live[0].operator, "Acme Ltd");
  assert.equal(overview.requests[0].status, "accepted");
  assert.ok(overview.activity.some((a) => a.kind === "accept"));

  assert.equal((await acme("POST", "/msfwr/end", undefined, viewer)).status, 204);
});

test("remote access URL: a company's PIN authors it, only that company sees it, and the admin console records it", async () => {
  const pc = client();
  const reg = await pc("POST", "/msfwr/standing", { key: pcKey("r"), name: "HOME-LAPTOP" });
  const created = await pc("POST", "/msfwr/link/create", { key: pcKey("r"), name: "HOME-LAPTOP", ttlHours: 24 });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const link = created.json;
  assert.match(link.pin, /^\d{6}$/);

  const admin = client();
  await admin("POST", "/auth/login", { username: "root", password: "admin-pass-123" });
  let record = (await admin("GET", "/admin/overview")).json.links.find((l) => l.code === link.code);
  assert.deepEqual([record.pcName, record.status, record.claim], ["HOME-LAPTOP", "active", undefined], "the URL is recorded on creation");

  const acme = client();
  await acme("POST", "/auth/login", { username: "acme", password: "acme-pass-123" });
  const before = (await acme("GET", "/msfwr/inbox")).json;
  const accessPin = before.accessPin.pin;
  assert.match(accessPin, /^\d{4}$/);
  assert.ok(before.accessPin.expiresAt - before.accessPin.issuedAt <= 3 * 60_000);
  assert.deepEqual(before.links, []);
  const rival = client();
  await rival("POST", "/auth/login", { username: "rival", password: "rival-pass-123" });
  const rivalPin = (await rival("GET", "/msfwr/inbox")).json.accessPin.pin;
  assert.notEqual(rivalPin, accessPin);

  const visitor = client();
  const info = await visitor("GET", `/msfwr/link/info?code=${link.code}`);
  assert.deepEqual([info.status, info.json.accessPinRequired, info.json.claimed], [200, true, false]);
  const urlOnly = await visitor("POST", "/msfwr/link/join", { code: link.code, pin: link.pin });
  assert.equal(urlOnly.status, 403, "the URL and its access code alone do not connect");
  const joined = await visitor("POST", "/msfwr/link/join", { code: link.code, pin: link.pin, accessPin });
  assert.equal(joined.status, 200, JSON.stringify(joined.json));
  assert.equal((await pc("POST", "/msfwr/tick", undefined, { authorization: `Bearer ${reg.json.token}` })).json.state, "live");
  const other = client();
  assert.equal((await other("POST", "/msfwr/link/join", { code: link.code, pin: link.pin, accessPin: rivalPin })).status, 403, "a second company cannot author the same URL");
  const both = await other("POST", "/msfwr/link/join", { code: link.code, pin: link.pin, accessPin });
  assert.equal(both.status, 200, "the authoring PIN keeps working for the URL");
  await visitor("POST", "/msfwr/end", undefined, { authorization: `Bearer ${joined.json.token}` });
  await other("POST", "/msfwr/end", undefined, { authorization: `Bearer ${both.json.token}` });

  const after = (await acme("GET", "/msfwr/inbox")).json;
  assert.notEqual(after.accessPin.pin, accessPin, "the company gets a new PIN for its next URL");
  assert.equal(after.links.length, 1);
  assert.deepEqual([after.links[0].code, after.links[0].claim.pin, after.links[0].claim.company], [link.code, accessPin, "Acme Ltd"]);
  assert.ok(after.links[0].claim.clientIp, "the address of the browser that entered the PIN is recorded");
  assert.deepEqual((await rival("GET", "/msfwr/inbox")).json.links, [], "other companies do not see it");
  for (let i = 0; i < 20 && !(await acme("GET", "/msfwr/inbox")).json.links[0].sessions.length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal((await acme("GET", "/msfwr/inbox")).json.links[0].sessions.length, 1, "the session is recorded against the URL");
  record = (await admin("GET", "/admin/overview")).json.links.find((l) => l.code === link.code);
  assert.deepEqual([record.claim.company, record.claim.pin, record.claim.raId], ["Acme Ltd", accessPin, "424242"]);
  const history = (await admin("GET", "/billing/sessions")).json.sessions;
  const acmeId = (await admin("GET", "/admin/users")).json.users.find((u) => u.username === "acme").id;
  assert.ok(history.some((h) => h.mode === "link" && h.operator === "Acme Ltd" && h.accountId === acmeId), "the session history credits the authoring company");

  assert.equal((await pc("POST", "/msfwr/link/revoke", { id: link.id, key: pcKey("r") })).status, 204);
  assert.equal((await visitor("GET", `/msfwr/link/info?code=${link.code}`)).status, 404);
  record = (await admin("GET", "/admin/overview")).json.links.find((l) => l.code === link.code);
  assert.equal(record.status, "cleared");
  assert.equal((await pc("POST", "/msfwr/link/register", { id: link.id, key: pcKey("r") })).status, 410);
});

test("accounts and Access PINs survive a relay restart", async () => {
  // A link made before the restart keeps its Access PIN once the PC restores it.
  const pc = client();
  await pc("POST", "/msfwr/standing", { key: pcKey("s"), name: "SHOP-PC", ra: "RA-424242" });
  const link = (await pc("POST", "/msfwr/link/create", { key: pcKey("s"), name: "SHOP-PC", ttlHours: 24 })).json;
  const before = client();
  await before("POST", "/auth/login", { username: "acme", password: "acme-pass-123" });
  const pinBefore = (await before("GET", "/msfwr/inbox")).json.accessPin.pin;
  assert.equal((await client()("POST", "/msfwr/link/join", { code: link.code, pin: link.pin, accessPin: pinBefore })).status, 200);
  await new Promise((r) => setTimeout(r, 200));
  server.kill();
  await new Promise((r) => server.once("exit", r));
  server = spawn(process.execPath, [path.join(here, "..", "dist", "index.mjs")], {
    env: { ...process.env, PORT: String(port), MSFWR_DATA_DIR: dataDir, NODE_ENV: "production", DATABASE_URL: "" },
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  const acme = client();
  assert.equal((await acme("POST", "/auth/login", { username: "acme", password: "acme-pass-123" })).status, 200);
  assert.equal((await client()("POST", "/auth/login", { username: "admin", password: "121212" })).status, 401, "no default admin once accounts exist");
  await pc("POST", "/msfwr/standing", { key: pcKey("s"), name: "SHOP-PC", ra: "RA-424242" });
  const restored = await pc("POST", "/msfwr/link/register", { id: link.id, key: pcKey("s"), pin: link.pin, name: "SHOP-PC", createdAt: link.createdAt, expiresAt: link.expiresAt });
  assert.equal(restored.status, 201);
  assert.equal((await acme("GET", "/msfwr/inbox")).json.links.find((l) => l.code === link.code).claim.pin, pinBefore, "the URL record survives a restart");
  const rivalNow = client();
  await rivalNow("POST", "/auth/login", { username: "rival", password: "rival-pass-123" });
  const rivalPin = (await rivalNow("GET", "/msfwr/inbox")).json.accessPin.pin;
  assert.equal((await client()("POST", "/msfwr/link/join", { code: link.code, pin: link.pin, accessPin: rivalPin })).status, 403, "the claim survives too");
});

test("a new relay has a default admin with PIN 121212 that must be changed at first sign-in", async () => {
  const freshPort = port + 1;
  const freshDir = mkdtempSync(path.join(tmpdir(), "msfwr-e2e-default-"));
  const env = { ...process.env, PORT: String(freshPort), MSFWR_DATA_DIR: freshDir, NODE_ENV: "production", DATABASE_URL: "" };
  delete env.ADMIN_PASSWORD;
  delete env.ADMIN_USERNAME;
  const fresh = spawn(process.execPath, [path.join(here, "..", "dist", "index.mjs")], { env, stdio: "ignore" });
  try {
    const freshBase = `http://127.0.0.1:${freshPort}/api`;
    for (let i = 0; i < 100; i++) {
      try { if ((await fetch(`${freshBase}/healthz`)).ok) break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 100));
    }
    const admin = client(freshBase);
    const me = await admin("POST", "/auth/login", { username: "admin", password: "121212" });
    assert.equal(me.status, 200, JSON.stringify(me.json));
    assert.deepEqual([me.json.role, me.json.mustChangePassword], ["admin", true]);
    assert.equal((await admin("GET", "/admin/users")).status, 403, "the console stays closed until the PIN is changed");
    assert.equal((await admin("POST", "/auth/password", { current: "121212", next: "short" })).status, 400);
    assert.equal((await admin("POST", "/auth/password", { current: "121212", next: "my-new-admin-pass" })).status, 204);
    assert.equal((await admin("GET", "/admin/users")).status, 200);
    assert.equal((await client(freshBase)("POST", "/auth/login", { username: "admin", password: "121212" })).status, 401, "the default PIN stops working");
    assert.equal((await client(freshBase)("POST", "/auth/login", { username: "admin", password: "my-new-admin-pass" })).status, 200);
  } finally {
    fresh.kill();
    await new Promise((r) => fresh.once("exit", r));
    rmSync(freshDir, { recursive: true, force: true });
  }
});

test("streaming: long-polled frames with patches, batched input and the host's input channel", async () => {
  const pc = client();
  const invite = (await pc("POST", "/msfwr/invite")).json;
  const acme = client();
  await acme("POST", "/auth/login", { username: "acme", password: "acme-pass-123" });
  const joined = await acme("POST", "/msfwr/join", { code: invite.code });
  assert.equal(joined.status, 200, JSON.stringify(joined.json));
  const host = { authorization: `Bearer ${invite.token}` };
  const viewer = { authorization: `Bearer ${joined.json.token}` };
  assert.equal((await pc("POST", "/msfwr/approve", undefined, host)).status, 204);

  const jpeg = (n) => Buffer.from([255, 216, n, 255, 217]);
  const item = (kind, x, y, data) => Buffer.concat([Buffer.from([kind, x >> 8, x & 255, y >> 8, y & 255, 0, 0, 0, data.length]), data]);
  const upload = (body) => fetch(`${base}/msfwr/tick`, { method: "POST", headers: { ...host, "content-type": "application/x-msfwr-frames", "x-msfwr-events": "1" }, body });

  // A viewer waiting for the screen is answered as soon as it arrives.
  const started = Date.now();
  const waiting = fetch(`${base}/msfwr/frame?after=0&v=2&wait=5000`, { headers: viewer });
  await new Promise((r) => setTimeout(r, 150));
  const ticked = await (await upload(Buffer.concat([item(0, 0, 0, jpeg(1)), item(1, 16, 32, jpeg(2))]))).json();
  assert.deepEqual([ticked.state, ticked.patches, ticked.input], ["live", true, []]);
  const res = await waiting;
  assert.ok(Date.now() - started < 3000, "the frame request returned when the frame arrived");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-msfwr-frame"), "2");
  assert.equal(res.headers.get("x-msfwr-batch"), "1");
  const body = Buffer.from(await res.arrayBuffer());
  assert.deepEqual([body.readUInt32BE(0), body[4], body.readUInt32BE(9)], [1, 0, 5]);
  assert.deepEqual([body.readUInt32BE(18), body[22], body.readUInt16BE(23), body.readUInt16BE(25)], [2, 1, 16, 32]);
  // Older viewers still get the keyframe as a JPEG.
  const legacy = await fetch(`${base}/msfwr/frame?after=0`, { headers: viewer });
  assert.equal(legacy.headers.get("content-type"), "image/jpeg");
  assert.deepEqual(Buffer.from(await legacy.arrayBuffer()), jpeg(1));
  // Nothing newer: an empty answer once the wait runs out.
  assert.equal((await fetch(`${base}/msfwr/frame?after=2&v=2&wait=100`, { headers: viewer })).status, 204);
  assert.equal((await upload(Buffer.from([1, 0, 0]))).status, 400);

  // The host's input channel returns as soon as the viewer sends a batch.
  const events = fetch(`${base}/msfwr/events?wait=5000`, { headers: host });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal((await acme("POST", "/msfwr/input", [{ kind: "down", button: 0, x: 0.5, y: 0.5 }, { kind: "up", button: 0, x: 0.5, y: 0.5 }], viewer)).status, 204);
  assert.deepEqual((await (await events).json()).input.map((a) => a.kind), ["down", "up"]);
  assert.equal((await acme("POST", "/msfwr/input", [{ kind: "down" }], viewer)).status, 400);

  // Ending the session releases a waiting request.
  const last = fetch(`${base}/msfwr/frame?after=2&v=2&wait=5000`, { headers: viewer });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal((await pc("POST", "/msfwr/end", undefined, host)).status, 204);
  assert.equal((await last).status, 410);
});

test("streaming v3: frames and input are pushed the moment they arrive; numbered ticks keep order; viewers pick quality", async () => {
  const pc = client();
  const invite = (await pc("POST", "/msfwr/invite")).json;
  const acme = client();
  await acme("POST", "/auth/login", { username: "acme", password: "acme-pass-123" });
  const joined = await acme("POST", "/msfwr/join", { code: invite.code });
  const host = { authorization: `Bearer ${invite.token}` };
  const viewer = { authorization: `Bearer ${joined.json.token}` };
  assert.equal((await pc("POST", "/msfwr/approve", undefined, host)).status, 204);
  const jpeg = (n) => Buffer.from([255, 216, n, 255, 217]);
  const item = (kind, x, y, data) => Buffer.concat([Buffer.from([kind, x >> 8, x & 255, y >> 8, y & 255, 0, 0, 0, data.length]), data]);
  const upload = (body, seq) => fetch(`${base}/msfwr/tick`, { method: "POST", headers: { ...host, "content-type": "application/x-msfwr-frames", "x-msfwr-events": "1", "x-msfwr-seq": String(seq) }, body });

  // Reads records off the viewer's stream as they arrive.
  const res = await fetch(`${base}/msfwr/frame?after=0&v=3`, { headers: viewer });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-msfwr-stream"), "1");
  const reader = res.body.getReader();
  let buffered = Buffer.alloc(0);
  const record = async () => {
    for (;;) {
      if (buffered.length >= 13) {
        const length = buffered.readUInt32BE(9);
        if (buffered.length >= 13 + length) {
          const out = { sequence: buffered.readUInt32BE(0), kind: buffered[4], x: buffered.readUInt16BE(5), data: buffered.subarray(13, 13 + length) };
          buffered = buffered.subarray(13 + length);
          return out;
        }
      }
      const { value, done } = await reader.read();
      if (done) return undefined;
      buffered = Buffer.concat([buffered, Buffer.from(value)]);
    }
  };
  const first = await record();
  assert.deepEqual([first.kind, first.data.toString()], [2, "live"], "the stream opens with the state");

  // Upload 2 overtakes upload 1; the viewer still gets them in order.
  const second = await (await upload(item(1, 32, 0, jpeg(2)), 2)).json();
  assert.equal(second.pipeline, true);
  await upload(item(0, 0, 0, jpeg(1)), 1);
  const got = [];
  while (got.length < 2) {
    const r = await record();
    if (r.kind !== 2) got.push(r);
  }
  assert.deepEqual(got.map((r) => [r.sequence, r.kind, r.data[2]]), [[1, 0, 1], [2, 1, 2]]);

  // Input reaches the host's stream as soon as it is sent, in order.
  const events = await fetch(`${base}/msfwr/events?stream=1`, { headers: host });
  assert.equal(events.headers.get("content-type"), "application/x-ndjson");
  const lines = events.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  const line = async () => {
    for (;;) {
      const at = text.indexOf("\n");
      if (at >= 0) { const out = JSON.parse(text.slice(0, at)); text = text.slice(at + 1); return out; }
      const { value, done } = await lines.read();
      if (done) return undefined;
      text += value;
    }
  };
  const send = (seq, list) => fetch(`${base}/msfwr/input`, { method: "POST", headers: { ...viewer, "content-type": "application/json", "x-msfwr-seq": String(seq) }, body: JSON.stringify(list) });
  assert.equal((await send(2, [{ kind: "key", key: "b" }])).status, 204);
  assert.equal((await send(1, [{ kind: "key", key: "a" }])).status, 204);
  const keys = [];
  while (keys.length < 2) keys.push(...(await line()).input.map((a) => a.key));
  assert.deepEqual(keys, ["a", "b"]);

  // The viewer asks for sharper pictures; the host hears it on its next tick.
  assert.equal((await acme("POST", "/msfwr/view", { quality: "sharp" }, viewer)).status, 204);
  assert.equal((await acme("POST", "/msfwr/view", { quality: "ultra" }, viewer)).status, 400);
  const beat = await fetch(`${base}/msfwr/tick`, { method: "POST", headers: { ...host, "x-msfwr-events": "1", "x-msfwr-seq": "3" } });
  assert.equal((await beat.json()).quality, "sharp");

  // Ending the session closes both streams with an "ended" record.
  assert.equal((await pc("POST", "/msfwr/end", undefined, host)).status, 204);
  let r;
  do { r = await record(); } while (r && !(r.kind === 2 && r.data.toString() === "ended"));
  assert.ok(r, "the viewer's stream says the session ended");
  let l;
  do { l = await line(); } while (l && l.state !== "ended");
  assert.ok(l, "the host's stream says the session ended");
});
