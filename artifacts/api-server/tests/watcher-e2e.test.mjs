// End-to-end test of the Inspect Buddy question watcher against the built
// relay: enabling a watcher on a live session, the GET that used to 404 with
// "No question watcher has run on that session yet", capture forwarding from
// /buddy/capture, and the force-exam override.
// Run after `pnpm --filter @workspace/api-server run build`:
//   node --test artifacts/api-server/tests/watcher-e2e.test.mjs
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
const dataDir = mkdtempSync(path.join(tmpdir(), "winrss-watcher-e2e-"));
let server;

before(async () => {
  server = spawn(process.execPath, [path.join(here, "..", "dist", "index.mjs")], {
    env: { ...process.env, PORT: String(port), MSFWR_DATA_DIR: dataDir, ADMIN_USERNAME: "root", ADMIN_PASSWORD: "admin-pass-123", ADMIN_CREATION_PIN: "654321", SESSION_SECRET: "watcher-e2e", NODE_ENV: "production", DATABASE_URL: "" },
    stdio: "ignore",
  });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/healthz`)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("relay did not start");
});
after(() => { server?.kill(); rmSync(dataDir, { recursive: true, force: true }); });

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

const admin = client();
const acme = client();
const pc = client();
const pcKey = (c) => c.repeat(43);
let viewer;
let host;
let sessionId;

test("set up a live session with the buddy master switch on", async () => {
  assert.equal((await admin("POST", "/auth/login", { username: "root", password: "admin-pass-123" })).status, 200);
  await admin("POST", "/admin/users", { username: "acme", displayName: "Acme", password: "acme-temp-1234", role: "company", raId: "424242" });
  await acme("POST", "/auth/login", { username: "acme", password: "acme-temp-1234" });
  await acme("POST", "/auth/password", { current: "acme-temp-1234", next: "acme-pass-1234" });
  const reg = await pc("POST", "/msfwr/standing", { key: pcKey("w"), name: "EXAM-PC", ra: "RA-424242" });
  assert.equal(reg.status, 201, JSON.stringify(reg.json));
  host = { authorization: `Bearer ${reg.json.token}` };
  assert.equal((await pc("POST", "/msfwr/call", { name: "EXAM-PC" }, host)).status, 204);
  const inbox = (await acme("GET", "/msfwr/inbox")).json;
  const accepted = await acme("POST", "/msfwr/accept", { id: inbox.requests[0].id });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.json));
  assert.equal((await pc("POST", "/msfwr/tick", undefined, host)).json.state, "live");
  viewer = { authorization: `Bearer ${accepted.json.token}` };
  sessionId = (await admin("GET", "/admin/overview")).json.live[0].id;
  // The watcher engine keeps its OWN settings store (separate from the AI
  // Buddy settings above): PATCH /admin/inspect/settings. Turn both on.
  const on = await admin("PATCH", "/admin/inspect/settings", { enabled: true });
  assert.equal(on.status, 200, JSON.stringify(on.json));
  assert.equal(on.json.enabled, true);
});

test("GET watchers/:id no longer 404s for an ongoing session", async () => {
  // Before the fix this returned 404 "No question watcher has run on that
  // session yet." even right after Start, because the record was only ever
  // created by POST. The route must now ensure the record exists.
  const got = await admin("GET", `/admin/buddy/watchers/${sessionId}`);
  assert.equal(got.status, 200, JSON.stringify(got.json));
  assert.equal(got.json.sessionId, sessionId);
  assert.ok(["off", "watching"].includes(got.json.status), `unexpected status ${got.json.status}`);
});

test("POST enable starts the watcher and captures flow through", async () => {
  const en = await admin("POST", `/admin/buddy/watchers/${sessionId}`, {});
  assert.equal(en.status, 200, JSON.stringify(en.json));
  assert.equal(en.json.status, "watching");
  // A settled exam screen forwarded via /buddy/capture must reach the engine.
  await client()("POST", "/buddy/capture", { text: "Exam Instructions\nAnswer all 50 questions.\n1. What is RAM?\nA) Random Access Memory\nB) Read Only" }, viewer);
  await new Promise((r) => setTimeout(r, 300));
  const st = await admin("GET", `/admin/buddy/watchers/${sessionId}`);
  assert.equal(st.status, 200);
  assert.ok(["watching", "exam-detected"].includes(st.json.status), `status=${st.json.status}`);
});

test("force-exam jumps into capture mode and records the flashing pager questions", async () => {
  const f = await admin("POST", `/admin/buddy/watchers/${sessionId}/force-exam`, {});
  assert.equal(f.status, 200, JSON.stringify(f.json));
  assert.equal(f.json.status, "exam-detected");
  await client()("POST", "/buddy/capture", { text: "2. Which protocol resolves IP to MAC?\nA) DHCP\nB) ARP\nC) DNS\nD) FTP" }, viewer);
  await new Promise((r) => setTimeout(r, 400));
  const st = await admin("GET", `/admin/buddy/watchers/${sessionId}`);
  assert.equal(st.json.questions.length >= 1, true, "question captured after force-exam");
});

test("GET watchers/:id still 404s for a session that never existed", async () => {
  const got = await admin("GET", "/admin/buddy/watchers/nosuchsession");
  assert.equal(got.status, 404);
});
