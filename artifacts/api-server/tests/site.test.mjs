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
  assert.deepEqual(s.tabs, { pcs: true, connect: true, download: true });
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
  await site.updateRegistration(r.id, { status: "approved", note: "Called" });
  assert.deepEqual(site.registrationCounts(), { pending: 0, approved: 1, dismissed: 0, total: 1 });
  await assert.rejects(site.updateRegistration(r.id, { status: "maybe" }), /pending, approved/);
  await site.removeRegistration(r.id);
  assert.equal(site.listRegistrations().length, 0);
});
