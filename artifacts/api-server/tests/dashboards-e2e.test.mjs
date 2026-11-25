// End-to-end test of the admin and company dashboards against the built relay:
// the admin creation PIN, access requests (accept, reject, action plan,
// comments, outcome), grace extensions and the company dashboard.
// Run after `pnpm --filter @workspace/api-server run build`:
//   node --test artifacts/api-server/tests/dashboards-e2e.test.mjs
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
const dataDir = mkdtempSync(path.join(tmpdir(), "winrss-dash-e2e-"));
let server;

before(async () => {
  server = spawn(process.execPath, [path.join(here, "..", "dist", "index.mjs")], {
    env: { ...process.env, PORT: String(port), MSFWR_DATA_DIR: dataDir, ADMIN_USERNAME: "root", ADMIN_PASSWORD: "admin-pass-123", SESSION_SECRET: "dash-e2e", ADMIN_CREATION_PIN: "654321", NODE_ENV: "production", DATABASE_URL: "" },
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
let companyId;

test("creating an admin needs the admin creation PIN; a company does not", async () => {
  assert.equal((await admin("POST", "/auth/login", { username: "root", password: "admin-pass-123" })).status, 200);
  const none = await admin("POST", "/admin/users", { username: "ops", password: "ops-temp-1234", role: "admin" });
  assert.equal(none.status, 403);
  assert.match(none.json.error, /6-digit/);
  const wrong = await admin("POST", "/admin/users", { username: "ops", password: "ops-temp-1234", role: "admin", adminPin: "111111" });
  assert.equal(wrong.status, 403);
  assert.match(wrong.json.error, /not correct/);
  const ok = await admin("POST", "/admin/users", { username: "ops", password: "ops-temp-1234", role: "admin", adminPin: "654321" });
  assert.equal(ok.status, 201, JSON.stringify(ok.json));
  assert.equal(ok.json.role, "admin");

  const company = await admin("POST", "/admin/users", { username: "acme", displayName: "Acme", password: "acme-temp-1234", role: "company" });
  assert.equal(company.status, 201);
  companyId = company.json.id;
  assert.equal((await admin("PATCH", `/admin/users/${companyId}`, { role: "admin" })).status, 403, "promoting to admin needs the PIN too");
  assert.equal((await admin("PATCH", `/admin/users/${companyId}`, { displayName: "Acme Ltd" })).status, 200, "other changes do not");
});

test("access requests are accepted with an action plan, comments and an outcome", async () => {
  const sent = await client()("POST", "/site/requests", { name: "Asha", company: "Beta", email: "asha@example.com", mobile: "9876543210", message: "Pricing?" });
  assert.equal(sent.status, 201);
  const list = (await admin("GET", "/admin/registrations")).json.registrations;
  const id = list[0].id;
  assert.equal(list[0].status, "pending");
  const accepted = await admin("PATCH", `/admin/registrations/${id}`, { status: "accepted", actionPlan: "Demo on Friday" });
  assert.deepEqual([accepted.json.status, accepted.json.actionPlan], ["accepted", "Demo on Friday"]);
  const commented = await admin("POST", `/admin/registrations/${id}/comments`, { text: "Sent the quote on WhatsApp" });
  assert.equal(commented.status, 201);
  assert.equal(commented.json.comments[0].by, "Administrator");
  const done = await admin("PATCH", `/admin/registrations/${id}`, { outcome: "converted" });
  assert.equal(done.json.outcome, "converted");
  assert.equal((await admin("PATCH", `/admin/registrations/${id}`, { status: "approved" })).status, 400);
  const dash = await admin("GET", "/admin/dashboard");
  assert.equal(dash.json.registrations.converted, 1);
});

test("grace extensions need remarks and raise the quota", async () => {
  const plan = await admin("POST", "/billing/plans", { name: "Starter", priceInr: 999, interval: "monthly", sessionQuota: 5 });
  await admin("PUT", `/billing/subscriptions/${companyId}`, { planId: plan.json.id, status: "active" });
  assert.equal((await admin("POST", `/billing/subscriptions/${companyId}/grace`, { amount: 10 })).status, 400);
  const r = await admin("POST", `/billing/subscriptions/${companyId}/grace`, { amount: 10, remarks: "Renewal in progress" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.entitlement.sessionQuota, r.json.entitlement.graceSessions], [15, 10]);
});

test("the company dashboard shows its subscription, and no Access PIN while it cannot start sessions", async () => {
  const acme = client();
  await acme("POST", "/auth/login", { username: "acme", password: "acme-temp-1234" });
  assert.equal((await acme("GET", "/company/dashboard")).status, 403, "closed until the password is changed");
  await acme("POST", "/auth/password", { current: "acme-temp-1234", next: "acme-pass-1234" });
  const d = await acme("GET", "/company/dashboard");
  assert.equal(d.status, 200, JSON.stringify(d.json));
  assert.equal(d.json.company.name, "Acme Ltd");
  assert.equal(d.json.subscription.plan.name, "Starter");
  assert.ok(d.json.subscription.currentPeriodEnd > Date.now());
  assert.deepEqual([d.json.usage.used, d.json.usage.quota, d.json.usage.grace, d.json.usage.blocked], [0, 15, 10, false]);
  assert.equal(d.json.history.days.length, 30);
  assert.equal(d.json.usage.graceLog[0].remarks, undefined, "grace remarks stay internal");
  assert.ok((await acme("GET", "/msfwr/inbox")).json.accessPin, "an active company gets a PIN");

  await admin("PUT", `/billing/subscriptions/${companyId}`, { status: "suspended" });
  const inbox = (await acme("GET", "/msfwr/inbox")).json;
  assert.equal(inbox.accessPin, undefined, "no PIN while the company cannot start sessions");
  assert.equal(inbox.pinBlocked.reason, "suspended");
  assert.equal((await acme("GET", "/company/dashboard")).json.usage.blocked, true);
});
