import assert from "node:assert/strict";
import test from "node:test";
import { createSite, memorySiteBackend, parseImage } from "../src/lib/site.ts";

async function makeSite(backend = memorySiteBackend()) {
  const { init, api } = createSite(backend, { clock: () => 1_000_000 });
  await init;
  return api;
}

const PNG = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).toString("base64");

test("defaults show every section and the request form", async () => {
  const site = await makeSite();
  const s = site.publicSettings();
  assert.deepEqual(s.tabs, { pcs: true, connect: true, download: true, test: false });
  assert.equal(s.signIn.requestAccess, true);
  assert.equal(s.logo, null);
});

test("hiding a tab is saved, but one section always stays visible", async () => {
  const backend = memorySiteBackend();
  const site = await makeSite(backend);
  await site.updateSettings({ tabs: { connect: false } });
  assert.equal(site.publicSettings().tabs.connect, false);
  assert.equal(site.publicSettings().tabs.pcs, true);
  await assert.rejects(site.updateSettings({ tabs: { pcs: false, download: false } }), /at least one/);
  const reloaded = await makeSite(backend);
  assert.equal(reloaded.publicSettings().tabs.connect, false);
});

test("the Test tab is off by default and can be toggled on", async () => {
  const backend = memorySiteBackend();
  const site = await makeSite(backend);
  assert.equal(site.publicSettings().tabs.test, false);
  // Turning it on does not count toward the "at least one visible" rule:
  // hiding pcs + connect + download is rejected even with test on.
  await assert.rejects(site.updateSettings({ tabs: { pcs: false, connect: false, download: false, test: true } }), /at least one/);
  assert.equal(site.publicSettings().tabs.test, false);
  await site.updateSettings({ tabs: { test: true } });
  assert.equal(site.publicSettings().tabs.test, true);
  const reloaded = await makeSite(backend);
  assert.equal(reloaded.publicSettings().tabs.test, true);
});

test("page content keeps newlines and strips control characters", async () => {
  const site = await makeSite();
  await site.updateSettings({ pages: { disclaimer: { enabled: true, body: "## Heading\n\nLine one\u0007\n- item" } } });
  const d = site.publicSettings().pages.disclaimer;
  assert.equal(d.enabled, true);
  assert.equal(d.title, "Disclaimer");
  assert.equal(d.body, "## Heading\n\nLine one\n- item");
});

test("images are checked against their type and size", async () => {
  assert.equal(parseImage("logo", PNG, 1).type, "image/png");
  assert.throws(() => parseImage("logo", "data:image/png;base64," + Buffer.from("GIF89a").toString("base64"), 1), /not the image type/);
  assert.throws(() => parseImage("og", "data:image/svg+xml;base64," + Buffer.from("<svg></svg>").toString("base64"), 1), /Social networks/);
  assert.throws(() => parseImage("favicon", "data:text/html;base64,PGh0bWw+", 1), /Upload a PNG/);
  const big = "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300 * 1024)]).toString("base64");
  assert.throws(() => parseImage("favicon", big, 1), /too large/);
  const site = await makeSite();
  const s = await site.setAsset("logo", PNG);
  assert.match(s.logo.url, /^\/api\/site\/asset\/logo\?v=/);
  assert.equal((await site.removeAsset("logo")).logo, null);
});

test("access requests are validated, de-duplicated and moderated", async () => {
  const site = await makeSite();
  await assert.rejects(site.addRegistration({ name: "A", email: "nope", mobile: "9876543210" }), /email/);
  await assert.rejects(site.addRegistration({ name: "A", email: "a@b.co", mobile: "12" }), /mobile/);
  const r = await site.addRegistration({ name: "Asha <b>", company: "Acme", email: "Asha@Example.com", mobile: "+91 98765 43210", message: "Need 10 seats" });
  assert.equal(r.name, "Asha b");
  assert.equal(r.email, "asha@example.com");
  await site.addRegistration({ name: "Asha", email: "asha@example.com", mobile: "+91 98765 43210", message: "" });
  assert.equal(site.listRegistrations().length, 1, "a second request from the same email updates the open one");
  assert.equal(site.listRegistrations()[0].message, "Need 10 seats");
  await site.updateRegistration(r.id, { status: "accepted", actionPlan: "Call back\nSend a quote" });
  assert.deepEqual(site.registrationCounts(), { pending: 0, accepted: 1, rejected: 0, converted: 0, closed: 0, total: 1 });
  assert.equal(site.listRegistrations()[0].actionPlan, "Call back\nSend a quote");
  await assert.rejects(site.updateRegistration(r.id, { status: "approved" }), /pending, accepted or rejected/);
  await assert.rejects(site.updateRegistration(r.id, { outcome: "won" }), /converted to customer or query closed/);
  await site.updateRegistration(r.id, { outcome: "converted" });
  assert.equal(site.registrationCounts().converted, 1);
  const c = await site.addRegistrationComment(r.id, "Spoke on WhatsApp", "Admin");
  assert.equal(c.comments.length, 1);
  assert.deepEqual([c.comments[0].text, c.comments[0].by], ["Spoke on WhatsApp", "Admin"]);
  await assert.rejects(site.addRegistrationComment(r.id, "   ", "Admin"), /Write a comment/);
  const left = await site.removeRegistrationComment(r.id, c.comments[0].id);
  assert.equal(left.comments.length, 0);
  await site.removeRegistration(r.id);
  assert.equal(site.listRegistrations().length, 0);
});

test("older requests move to accepted and rejected, and their note becomes a comment", async () => {
  const backend = memorySiteBackend({ registrations: [
    { id: "a", name: "A", company: "", email: "a@b.co", mobile: "9876543210", message: "", status: "approved", note: "Called", createdAt: 1, updatedAt: 2 },
    { id: "b", name: "B", company: "", email: "b@b.co", mobile: "9876543210", message: "", status: "dismissed", note: "", createdAt: 1, updatedAt: 1 },
  ] });
  const site = await makeSite(backend);
  const [a, b] = site.listRegistrations();
  assert.deepEqual([a.status, b.status], ["accepted", "rejected"]);
  assert.equal(a.comments[0].text, "Called");
  assert.deepEqual([b.comments, b.outcome, b.actionPlan], [[], "", ""]);
});
