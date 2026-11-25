// End-to-end billing API test against the built relay (dist/index.mjs):
// subscription plans, per-company subscription config, the host-registration
// gate, payments/dues, and the client config bundle.
// Run after `pnpm --filter @workspace/api-server run build`:
//   node --test artifacts/api-server/tests/billing-e2e.test.mjs
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
const dataDir = mkdtempSync(path.join(tmpdir(), "winrss-billing-e2e-"));
let server;

before(async () => {
  server = spawn(process.execPath, [path.join(here, "..", "dist", "index.mjs")], {
    env: { ...process.env, PORT: String(port), MSFWR_DATA_DIR: dataDir, ADMIN_USERNAME: "root", ADMIN_PASSWORD: "admin-pass-123", SESSION_SECRET: "billing-e2e", NODE_ENV: "production", DATABASE_URL: "" },
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

const pcKey = (c) => c.repeat(43);
async function registerStanding(key, name, ra, license) {
  const res = await fetch(`${base}/msfwr/standing`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ key, name, ra, ...(license ? { license } : {}) }),
  });
  return { status: res.status, json: await res.json().catch(() => undefined) };
}

const admin = client();
let companyId;
let companyRa;
let planId;

test("admin signs in and creates a company", async () => {
  assert.equal((await admin("POST", "/auth/login", { username: "root", password: "admin-pass-123" })).status, 200);
  const r = await admin("POST", "/admin/users", { username: "acmeco", password: "company-pass-123", role: "company", displayName: "Acme Co" });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  companyId = r.json.id;
  companyRa = r.json.raId;
  assert.match(companyRa, /^\d{6}$/);
});

test("create a plan priced in INR", async () => {
  const r = await admin("POST", "/billing/plans", { name: "Starter", priceInr: 999, interval: "monthly", sessionQuota: 2 });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  planId = r.json.id;
  assert.equal(r.json.priceInr, 999);
});

test("a company with no subscription registers ungated", async () => {
  const r = await registerStanding(pcKey("a"), "Front Desk", companyRa);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  assert.equal(r.json.subStatus, "none");
});

test("assigning an active subscription gates to active", async () => {
  const r = await admin("PUT", `/billing/subscriptions/${companyId}`, { planId, status: "active" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.entitlement.status, "active");
  assert.equal(r.json.entitlement.sessionQuota, 2);
  const reg = await registerStanding(pcKey("b"), "Front Desk", companyRa);
  assert.equal(reg.status, 201);
  assert.equal(reg.json.subStatus, "active");
});

test("suspending blocks registration with 402, reactivating restores it", async () => {
  assert.equal((await admin("PUT", `/billing/subscriptions/${companyId}`, { status: "suspended" })).status, 200);
  const blocked = await registerStanding(pcKey("c"), "Front Desk", companyRa);
  assert.equal(blocked.status, 402, JSON.stringify(blocked.json));
  assert.equal(blocked.json.reason, "suspended");
  assert.equal((await admin("PUT", `/billing/subscriptions/${companyId}`, { status: "active" })).status, 200);
  assert.equal((await registerStanding(pcKey("d"), "Front Desk", companyRa)).status, 201);
});

test("a past-due payment appears in overdue dues", async () => {
  const past = Date.now() - 10 * 24 * 60 * 60_000;
  const r = await admin("POST", "/billing/payments", { accountId: companyId, amountInr: 999, dueDate: past, status: "due" });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const dues = await admin("GET", "/billing/dues");
  assert.ok(dues.json.overdue.some((p) => p.accountId === companyId));
});

test("the client config bundle carries relay, RA ID and a license", async () => {
  const r = await admin("GET", `/billing/companies/${companyId}/client?origin=https://support.example.com`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.config.relay, "https://support.example.com");
  assert.equal(r.json.config.raId, companyRa);
  assert.match(r.json.config.license, /^L1\./);
  assert.equal(r.json.subscription.status, "active");
});

test("companies list and summary reflect the subscription", async () => {
  const companies = await admin("GET", "/billing/companies");
  const acme = companies.json.companies.find((c) => c.id === companyId);
  assert.equal(acme.subscription.status, "active");
  assert.ok(acme.nextDue);
  const summary = await admin("GET", "/billing/summary");
  assert.equal(summary.json.activeSubscriptions, 1);
  assert.ok(summary.json.mrrInr >= 999);
});

test("state survives a relay restart (durable billing store)", async () => {
  const fresh = client();
  assert.equal((await fresh("POST", "/auth/login", { username: "root", password: "admin-pass-123" })).status, 200);
  const r = await fresh("GET", "/billing/plans");
  assert.ok(r.json.plans.some((p) => p.id === planId), "plan persisted to disk");
});

test("non-admins cannot reach billing", async () => {
  const anon = client();
  assert.equal((await anon("GET", "/billing/plans")).status, 401);
});

test("a forged or mismatched license is refused even when the subscription is active", async () => {
  const bundle = await admin("GET", `/billing/companies/${companyId}/client?origin=https://support.example.com`);
  const license = bundle.json.config.license;
  // A valid license registers fine.
  assert.equal((await registerStanding(pcKey("e"), "Desk", companyRa, license)).status, 201);
  // A tampered license is rejected.
  const forged = await registerStanding(pcKey("f"), "Desk", companyRa, license + "x");
  assert.equal(forged.status, 402, JSON.stringify(forged.json));
  assert.equal(forged.json.reason, "license");
});

test("requireLicense blocks an unlicensed PC and allows a licensed one", async () => {
  await admin("PUT", `/billing/subscriptions/${companyId}`, { requireLicense: true });
  const noLicense = await registerStanding(pcKey("g"), "Desk", companyRa);
  assert.equal(noLicense.status, 402, JSON.stringify(noLicense.json));
  assert.equal(noLicense.json.reason, "license");
  const bundle = await admin("GET", `/billing/companies/${companyId}/client?origin=https://support.example.com`);
  const ok = await registerStanding(pcKey("h"), "Desk", companyRa, bundle.json.config.license);
  assert.equal(ok.status, 201);
  // Revoking licenses invalidates the issued one immediately.
  await admin("POST", `/billing/subscriptions/${companyId}/revoke-license`, {});
  const revoked = await registerStanding(pcKey("i"), "Desk", companyRa, bundle.json.config.license);
  assert.equal(revoked.status, 402);
  assert.equal(revoked.json.reason, "license");
  // Clean up so later assertions about active status hold.
  await admin("PUT", `/billing/subscriptions/${companyId}`, { requireLicense: false });
});

test("a company that is suspended or over quota cannot connect to its PC", async () => {
  // A fresh company so the ordering of earlier assertions is unaffected.
  const made = await admin("POST", "/admin/users", { username: "gateco", password: "temp-pass-123", role: "company", displayName: "Gate Co" });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  const gateId = made.json.id;
  const gateRa = made.json.raId;

  // The company signs in and chooses its own password (admin-set passwords are temporary).
  const company = client();
  assert.equal((await company("POST", "/auth/login", { username: "gateco", password: "temp-pass-123" })).status, 200);
  assert.equal((await company("POST", "/auth/password", { current: "temp-pass-123", next: "gate-pass-123" })).status, 204);

  // A single-session plan, active.
  const plan = await admin("POST", "/billing/plans", { name: "Solo", priceInr: 100, interval: "monthly", sessionQuota: 1 });
  assert.equal((await admin("PUT", `/billing/subscriptions/${gateId}`, { planId: plan.json.id, status: "active" })).status, 200);

  // A PC registers for the company's RA (ungated while active) and shows in the inbox.
  assert.equal((await registerStanding(pcKey("k"), "Gate-PC", gateRa)).status, 201);
  const inbox = await company("GET", "/msfwr/inbox");
  const pc = inbox.json.pcs.find((p) => p.name === "Gate-PC");
  assert.ok(pc, "the PC appears in the company inbox");

  // Suspended: the company cannot open a session even though the PC is up.
  assert.equal((await admin("PUT", `/billing/subscriptions/${gateId}`, { status: "suspended" })).status, 200);
  const blocked = await company("POST", "/msfwr/connect", { pc: pc.id });
  assert.equal(blocked.status, 402, JSON.stringify(blocked.json));
  assert.equal(blocked.json.reason, "suspended");

  // Reactivated: it connects. One session at a time does not use the quota.
  assert.equal((await admin("PUT", `/billing/subscriptions/${gateId}`, { status: "active" })).status, 200);
  const ok = await company("POST", "/msfwr/connect", { pc: pc.id });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  await new Promise((r) => setTimeout(r, 200));
  const usedOf = async () => (await admin("GET", "/billing/companies")).json.companies.find((c) => c.id === gateId)?.entitlement.sessionsUsed ?? 0;
  assert.equal(await usedOf(), 0, "a single live session is not counted");

  // A second session while the first is live is counted against the quota.
  assert.equal((await registerStanding(pcKey("m"), "Gate-PC2", gateRa)).status, 201);
  const pc2 = (await company("GET", "/msfwr/inbox")).json.pcs.find((p) => p.name === "Gate-PC2");
  const second = await company("POST", "/msfwr/connect", { pc: pc2.id });
  assert.equal(second.status, 200, JSON.stringify(second.json));
  // Wait for that live-start to be counted (the store reports it to billing
  // asynchronously via its lifecycle hook).
  let used = 0;
  for (let i = 0; i < 50 && used < 1; i++) {
    used = await usedOf();
    if (used < 1) await new Promise((r) => setTimeout(r, 50));
  }
  assert.equal(used, 1, "the extra live session was counted against the quota");

  // The quota is now spent, so a further connect is refused for quota. The gate
  // runs before PC availability, so the reason is the subscription, not the PC.
  const overQuota = await company("POST", "/msfwr/connect", { pc: pc.id });
  assert.equal(overQuota.status, 402, JSON.stringify(overQuota.json));
  assert.equal(overQuota.json.reason, "quota");
});

test("security headers are present on API responses", async () => {
  const res = await fetch(`${base}/healthz`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
});
