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

test("remote access URL: create from the PC, open with the access code and the company's Access PIN, clear it", async () => {
  const pc = client();
  const reg = await pc("POST", "/msfwr/standing", { key: pcKey("r"), name: "HOME-LAPTOP", ra: "RA-424242" });
  const created = await pc("POST", "/msfwr/link/create", { key: pcKey("r"), name: "HOME-LAPTOP", ttlHours: 24 });
  assert.equal(created.status, 201, JSON.stringify(created.json));
  const link = created.json;
  assert.match(link.pin, /^\d{6}$/);
  assert.equal(link.accessPin, undefined, "the PC is not given the Access PIN");

  // Only the company behind the PC's RA ID sees the Access PIN.
  const acme = client();
  await acme("POST", "/auth/login", { username: "acme", password: "acme-pass-123" });
  const links = (await acme("GET", "/msfwr/inbox")).json.links;
  assert.equal(links.length, 1);
  assert.deepEqual([links[0].name, links[0].expiresAt], ["HOME-LAPTOP", link.expiresAt]);
  const accessPin = links[0].accessPin;
  assert.match(accessPin, /^\d{4}$/);
  assert.ok(!JSON.stringify(links).includes(link.code), "the company view does not carry the URL");
  const rival = client();
  await rival("POST", "/auth/login", { username: "rival", password: "rival-pass-123" });
  assert.deepEqual((await rival("GET", "/msfwr/inbox")).json.links, []);
  const admin = client();
  await admin("POST", "/auth/login", { username: "root", password: "admin-pass-123" });
  assert.equal((await admin("GET", "/admin/overview")).json.links[0].accessPin, accessPin, "relay admins see it too");

  const visitor = client();
  const info = await visitor("GET", `/msfwr/link/info?code=${link.code}`);
  assert.deepEqual([info.status, info.json.name, info.json.online, info.json.accessPinRequired], [200, "HOME-LAPTOP", true, true]);
  const wrong = link.pin === "000000" ? "000001" : "000000";
  assert.equal((await visitor("POST", "/msfwr/link/join", { code: link.code, pin: wrong, accessPin })).status, 403);
  const urlOnly = await visitor("POST", "/msfwr/link/join", { code: link.code, pin: link.pin });
  assert.equal(urlOnly.status, 403, "the URL and its access code alone do not connect");
  assert.match(urlOnly.json.error, /Access PIN/);
  const badPin = accessPin === "0000" ? "0001" : "0000";
  assert.equal((await visitor("POST", "/msfwr/link/join", { code: link.code, pin: link.pin, accessPin: badPin })).status, 403);
  const joined = await visitor("POST", "/msfwr/link/join", { code: link.code, pin: link.pin, accessPin });
  assert.equal(joined.status, 200);
  assert.equal((await pc("POST", "/msfwr/tick", undefined, { authorization: `Bearer ${reg.json.token}` })).json.state, "live");
  const other = client();
  const both = await other("POST", "/msfwr/link/join", { code: link.code, pin: link.pin, accessPin });
  assert.equal(both.status, 200, "a second person can connect through the same URL");
  assert.equal((await other("GET", `/msfwr/link/info?code=${link.code}`)).json.viewers, 2);
  await visitor("POST", "/msfwr/end", undefined, { authorization: `Bearer ${joined.json.token}` });
  assert.equal((await pc("POST", "/msfwr/tick", undefined, { authorization: `Bearer ${reg.json.token}` })).json.state, "live", "still live for the other person");
  await other("POST", "/msfwr/end", undefined, { authorization: `Bearer ${both.json.token}` });

  const status = await pc("GET", `/msfwr/link/status?id=${link.id}&key=${pcKey("r")}`);
  assert.equal(status.json.link.sessions, 2);
  assert.equal(status.json.link.accessPin, undefined);
  assert.equal((await pc("POST", "/msfwr/link/revoke", { id: link.id, key: pcKey("r") })).status, 204);
  assert.equal((await visitor("GET", `/msfwr/link/info?code=${link.code}`)).status, 404);
  assert.deepEqual((await acme("GET", "/msfwr/inbox")).json.links, [], "a cleared URL leaves the company's list");
  // The PC re-sending a cleared link does not bring it back unless it has the pin (a restore).
  assert.equal((await pc("POST", "/msfwr/link/register", { id: link.id, key: pcKey("r") })).status, 410);
});

test("accounts and Access PINs survive a relay restart", async () => {
  // A link made before the restart keeps its Access PIN once the PC restores it.
  const pc = client();
  await pc("POST", "/msfwr/standing", { key: pcKey("s"), name: "SHOP-PC", ra: "RA-424242" });
  const link = (await pc("POST", "/msfwr/link/create", { key: pcKey("s"), name: "SHOP-PC", ttlHours: 24 })).json;
  const before = client();
  await before("POST", "/auth/login", { username: "acme", password: "acme-pass-123" });
  const pinBefore = (await before("GET", "/msfwr/inbox")).json.links[0].accessPin;
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
  assert.equal((await acme("GET", "/msfwr/inbox")).json.links[0].accessPin, pinBefore, "the Access PIN is the same after a restart");
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
