import assert from "node:assert/strict";
import test from "node:test";
import { createAccounts, memoryBackend, normalizeRaId } from "../src/lib/accounts.ts";

test("accounts get unique RA IDs, hashed passwords and signed logins", async () => {
  const backend = memoryBackend();
  const accounts = await createAccounts(backend);
  assert.equal(accounts.empty, true);
  const admin = await accounts.create({username: "Admin", displayName: "Siv", password: "correct horse", role: "admin"});
  const ra = await accounts.create({username: "tech1", password: "battery staple", role: "ra"});
  assert.equal(admin.username, "admin");
  assert.match(admin.raId, /^\d{6}$/);
  assert.notEqual(admin.raId, ra.raId);
  assert.equal("hash" in admin, false);
  await assert.rejects(accounts.create({username: "tech1", password: "whatever12", role: "ra"}), /taken/);
  await assert.rejects(accounts.create({username: "x", password: "whatever12", role: "ra"}), /Usernames/);
  await assert.rejects(accounts.create({username: "tech2", password: "short", role: "ra"}), /8 characters/);
  assert.equal(await accounts.verify("tech1", "wrong password"), undefined);
  assert.equal((await accounts.verify("TECH1", "battery staple")).id, ra.id);
  const token = accounts.issue(ra.id);
  assert.equal(accounts.session(token).id, ra.id);
  assert.equal(accounts.session(token.slice(0, -2) + "xx"), undefined);
  assert.equal(accounts.findRa(`RA-${ra.raId}`).id, ra.id);
  // A password reset or disabling signs the user out everywhere.
  await accounts.update(ra.id, {password: "new password 1"});
  assert.equal(accounts.session(token), undefined);
  const second = accounts.issue(ra.id);
  await accounts.update(ra.id, {disabled: true});
  assert.equal(accounts.session(second), undefined);
  assert.equal(accounts.findRa(ra.raId), undefined);
  await assert.rejects(accounts.verify("tech1", "new password 1"), /disabled/);
  // The data (and the signing secret) survive a restart.
  await accounts.flush();
  const reopened = await createAccounts(backend);
  assert.equal(reopened.list().length, 2);
  await reopened.update(ra.id, {disabled: false});
  assert.equal(reopened.session(reopened.issue(ra.id)).id, ra.id);
});

test("the last active admin cannot be removed, demoted or disabled", async () => {
  const accounts = await createAccounts(memoryBackend());
  const a = await accounts.create({username: "admin", password: "password1", role: "admin"});
  const b = await accounts.create({username: "boss", password: "password1", role: "admin"});
  await assert.rejects(accounts.remove(a.id, a.id), /your own/);
  await accounts.update(b.id, {role: "ra"}, a.id);
  await assert.rejects(accounts.update(a.id, {disabled: true}, b.id), /at least one/);
  await assert.rejects(accounts.remove(a.id, b.id), /at least one/);
});

test("RA IDs accept common spellings", () => {
  assert.equal(normalizeRaId("RA-123456"), "123456");
  assert.equal(normalizeRaId(" ra 123 456 "), "123456");
  assert.equal(normalizeRaId("12345"), undefined);
});
