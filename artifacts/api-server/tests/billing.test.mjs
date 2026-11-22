import assert from "node:assert/strict";
import test from "node:test";
import { createBilling, memoryBillingBackend, effectiveStatus, DAY } from "../src/lib/billing.ts";

async function makeBilling(now) {
  const clock = () => now.value;
  const { init, api } = createBilling(memoryBillingBackend(), { secret: "test-secret", clock });
  await init;
  return api;
}

test("plans are created, priced in INR and listed cheapest first", async () => {
  const now = { value: 1_000_000 };
  const b = await makeBilling(now);
  const annual = await b.createPlan({ name: "Pro Annual", priceInr: 12000, interval: "annual", sessionQuota: 0 });
  const monthly = await b.createPlan({ name: "Starter", priceInr: 500, interval: "monthly", sessionQuota: 50 });
  assert.equal(annual.priceInr, 12000);
  assert.equal(monthly.sessionQuota, 50);
  const list = b.listPlans();
  assert.deepEqual(list.map((p) => p.name), ["Starter", "Pro Annual"]);
});

test("a company with no subscription is ungated, but gating starts once one is set", async () => {
  const now = { value: 1_000_000 };
  const b = await makeBilling(now);
  assert.equal(b.canStartSession("acct-1").ok, true, "legacy company with no sub is allowed");
  const plan = await b.createPlan({ name: "Starter", priceInr: 500, interval: "monthly", sessionQuota: 3 });
  await b.setSubscription("acct-1", { planId: plan.id, status: "active" });
  const gate = b.canStartSession("acct-1");
  assert.equal(gate.ok, true);
  assert.equal(gate.entitlement.status, "active");
  assert.equal(gate.entitlement.remaining, 3);
});

test("an expired period blocks sessions until renewed", async () => {
  const now = { value: 1_000_000 };
  const b = await makeBilling(now);
  const plan = await b.createPlan({ name: "Starter", priceInr: 500, interval: "monthly", sessionQuota: 0 });
  await b.setSubscription("acct-1", { planId: plan.id, status: "active", autoRenew: false });
  assert.equal(b.canStartSession("acct-1").ok, true);
  now.value += 31 * DAY;
  const gate = b.canStartSession("acct-1");
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "expired");
  const { subscription } = await b.renew("acct-1");
  assert.equal(subscription.status, "active");
  assert.equal(b.canStartSession("acct-1").ok, true);
});

test("session quota blocks the next start once reached and resets on renew", async () => {
  const now = { value: 1_000_000 };
  const b = await makeBilling(now);
  const plan = await b.createPlan({ name: "Starter", priceInr: 500, interval: "monthly", sessionQuota: 2 });
  await b.setSubscription("acct-1", { planId: plan.id, status: "active" });
  await b.countSession("acct-1");
  assert.equal(b.canStartSession("acct-1").ok, true);
  await b.countSession("acct-1");
  const gate = b.canStartSession("acct-1");
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "quota");
  await b.renew("acct-1", { markPaid: true });
  assert.equal(b.canStartSession("acct-1").ok, true, "renew resets usage");
  assert.equal(b.entitlement("acct-1").sessionsUsed, 0);
});

test("suspended blocks regardless of period", async () => {
  const now = { value: 1_000_000 };
  const b = await makeBilling(now);
  const plan = await b.createPlan({ name: "Starter", priceInr: 500, interval: "monthly" });
  await b.setSubscription("acct-1", { planId: plan.id, status: "suspended" });
  const gate = b.canStartSession("acct-1");
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "suspended");
});

test("licenses verify, carry identity, and are revoked by version bump", async () => {
  const now = { value: 1_000_000 };
  const b = await makeBilling(now);
  await b.setSubscription("acct-1", { status: "active" });
  const token = b.issueLicense("acct-1", "123456");
  const id = b.verifyLicense(token);
  assert.equal(id.accountId, "acct-1");
  assert.equal(id.raId, "123456");
  assert.equal(b.verifyLicense(token + "x"), undefined, "tampered token rejected");
  await b.revokeLicenses("acct-1");
  assert.equal(b.verifyLicense(token), undefined, "old license revoked after version bump");
  const fresh = b.issueLicense("acct-1", "123456");
  assert.ok(b.verifyLicense(fresh), "a new license works after revoke");
});

test("a license from another relay secret does not verify", async () => {
  const now = { value: 1_000_000 };
  const b1 = createBilling(memoryBillingBackend(), { secret: "secret-a", clock: () => now.value });
  await b1.init;
  const token = b1.api.issueLicense("acct-1", "123456");
  const b2 = createBilling(memoryBillingBackend(), { secret: "secret-b", clock: () => now.value });
  await b2.init;
  assert.equal(b2.api.verifyLicense(token), undefined);
});

test("payments track dues, overdue and paid; summary totals overdue", async () => {
  const now = { value: 1_000_000 };
  const b = await makeBilling(now);
  const plan = await b.createPlan({ name: "Starter", priceInr: 500, interval: "monthly" });
  await b.setSubscription("acct-1", { planId: plan.id, status: "active" });
  await b.addPayment("acct-1", { amountInr: 500, dueDate: now.value - 5 * DAY, status: "due" });
  await b.addPayment("acct-1", { amountInr: 500, dueDate: now.value + 10 * DAY, status: "due" });
  const dues = b.dues();
  assert.equal(dues.overdue.length, 1, "past-due becomes overdue");
  assert.equal(dues.upcoming.length, 1);
  const s = b.summary();
  assert.equal(s.overdueAmountInr, 500);
  assert.equal(s.activeSubscriptions, 1);
  assert.ok(s.mrrInr >= 500);
});

test("session history is recorded and filterable", async () => {
  const now = { value: 1_000_000 };
  const b = await makeBilling(now);
  await b.recordSession({ accountId: "acct-1", raId: "123456", pcName: "PC-1", mode: "unattended", operator: "Acme", startedAt: now.value - 60_000, endedAt: now.value, durationMs: 60_000, viewers: 1 });
  await b.recordSession({ accountId: "acct-2", raId: "654321", pcName: "PC-2", mode: "link", operator: "", startedAt: now.value - 30_000, endedAt: now.value, durationMs: 30_000, viewers: 2 });
  assert.equal(b.listSessions().length, 2);
  assert.equal(b.listSessions({ accountId: "acct-1" }).length, 1);
  assert.equal(b.listSessions({ raId: "654321" })[0].pcName, "PC-2");
});

test("state persists across a reload of the same backend", async () => {
  const now = { value: 1_000_000 };
  const backend = memoryBillingBackend();
  const first = createBilling(backend, { secret: "s", clock: () => now.value });
  await first.init;
  const plan = await first.api.createPlan({ name: "Starter", priceInr: 500, interval: "monthly", sessionQuota: 5 });
  await first.api.setSubscription("acct-1", { planId: plan.id, status: "active" });
  const token = first.api.issueLicense("acct-1", "123456");
  await first.api.flush();
  const second = createBilling(backend, { secret: "s", clock: () => now.value });
  await second.init;
  assert.equal(second.api.listPlans().length, 1);
  assert.ok(second.api.getSubscription("acct-1"));
  assert.ok(second.api.verifyLicense(token), "license still valid after reload");
});

test("effectiveStatus flips active to expired past the period end", () => {
  const sub = { status: "active", currentPeriodEnd: 100 };
  assert.equal(effectiveStatus(sub, 50), "active");
  assert.equal(effectiveStatus(sub, 150), "expired");
});

test("checkLicense distinguishes ok, mismatch, invalid and absent", async () => {
  const now = { value: 1_000_000 };
  const b = await makeBilling(now);
  await b.setSubscription("acct-1", { status: "active" });
  await b.setSubscription("acct-2", { status: "active" });
  const t1 = b.issueLicense("acct-1", "123456");
  assert.equal(b.checkLicense("acct-1", t1), "ok");
  assert.equal(b.checkLicense("acct-2", t1), "mismatch");
  assert.equal(b.checkLicense("acct-1", t1 + "x"), "invalid");
  assert.equal(b.checkLicense("acct-1", undefined), "absent");
  await b.revokeLicenses("acct-1");
  assert.equal(b.checkLicense("acct-1", t1), "invalid", "revoked license is invalid");
});

test("requireLicense is persisted and surfaced on the entitlement", async () => {
  const now = { value: 1_000_000 };
  const b = await makeBilling(now);
  await b.setSubscription("acct-1", { status: "active", requireLicense: true });
  assert.equal(b.entitlement("acct-1").requireLicense, true);
  await b.setSubscription("acct-1", { requireLicense: false });
  assert.equal(b.entitlement("acct-1").requireLicense, false);
});
