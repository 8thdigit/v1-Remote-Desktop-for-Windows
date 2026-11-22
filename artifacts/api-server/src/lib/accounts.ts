import { createHmac, randomBytes, randomInt, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

// Accounts for the web portal. Admins manage the system; RA (remote access)
// users answer requests and connect to PCs. Every account has a unique RA ID
// that a PC is told, so its Initiate request reaches that person only.

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, options: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export type Role = "admin" | "ra";

export type Account = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  raId: string;
  disabled: boolean;
  createdAt: number;
  lastLoginAt?: number;
  // Bumped when the password changes or the account is disabled, which
  // invalidates every login token issued before.
  version: number;
  hash: string;
  salt: string;
};

export type PublicAccount = Omit<Account, "hash" | "salt" | "version">;

type Data = { users: Account[]; secret?: string };

export type Backend = {
  load(): Promise<Data | undefined>;
  save(data: Data): Promise<void>;
  describe: string;
};

// The session lifetime of a portal login.
export const loginTTL = 12 * 60 * 60_000;

export const USERNAME = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function normalizeRaId(value: string) {
  const digits = value.replace(/\D/g, "");
  return /^\d{6}$/.test(digits) ? digits : undefined;
}

export const formatRaId = (raId: string) => `RA-${raId}`;

export function publicAccount(a: Account): PublicAccount {
  const { hash: _h, salt: _s, version: _v, ...rest } = a;
  return rest;
}

const cleanName = (v: string) => v.replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 60);

export function fileBackend(dir: string): Backend {
  const file = path.join(dir, "accounts.json");
  return {
    describe: file,
    async load() {
      try {
        return JSON.parse(await readFile(file, "utf8")) as Data;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw e;
      }
    },
    async save(data) {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
      await rename(tmp, file);
    },
  };
}

// Stores the whole account document as one row, so no migration step is
// needed when the relay runs with a database (DATABASE_URL).
export async function postgresBackend(url: string): Promise<Backend> {
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  await pool.query("CREATE TABLE IF NOT EXISTS winss132r_state (id text PRIMARY KEY, data jsonb NOT NULL)");
  return {
    describe: "PostgreSQL (DATABASE_URL)",
    async load() {
      const r = await pool.query("SELECT data FROM winss132r_state WHERE id = 'accounts'");
      return r.rows[0]?.data as Data | undefined;
    },
    async save(data) {
      await pool.query(
        "INSERT INTO winss132r_state (id, data) VALUES ('accounts', $1) ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data",
        [JSON.stringify(data)],
      );
    },
  };
}

export function memoryBackend(initial?: Data): Backend {
  let data = initial ? structuredClone(initial) : undefined;
  return {
    describe: "memory",
    async load() { return data && structuredClone(data); },
    async save(next) { data = structuredClone(next); },
  };
}

export class AccountError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function hashPassword(password: string, salt = randomBytes(16)) {
  const key = await scrypt(password, salt, 32, SCRYPT);
  return { hash: key.toString("base64"), salt: salt.toString("base64") };
}

export function checkPassword(password: string) {
  if (typeof password !== "string" || password.length < 8) return "Passwords need at least 8 characters.";
  if (password.length > 200) return "That password is too long.";
  return undefined;
}

export async function createAccounts(backend: Backend, options: { secret?: string; clock?: () => number } = {}) {
  const clock = options.clock ?? Date.now;
  const loaded = await backend.load();
  const users: Account[] = Array.isArray(loaded?.users) ? loaded.users : [];
  let storedSecret = loaded?.secret;
  if (!options.secret && !storedSecret) storedSecret = randomBytes(32).toString("base64url");
  const secret = options.secret || storedSecret!;
  // A wrong-length dummy hash keeps login timing the same for unknown users.
  const dummy = await hashPassword(randomBytes(12).toString("hex"));

  let writing = Promise.resolve();
  const persist = () => {
    const snapshot: Data = { users: structuredClone(users), secret: storedSecret };
    writing = writing.then(() => backend.save(snapshot));
    return writing;
  };
  if (!loaded || (storedSecret && !loaded.secret)) await persist();

  const byId = (id: string) => users.find((u) => u.id === id);
  const byUsername = (username: string) => users.find((u) => u.username === username.toLowerCase());
  const byRa = (raId: string) => users.find((u) => u.raId === raId);

  function newRaId() {
    for (;;) {
      const id = String(randomInt(100000, 1000000));
      if (!byRa(id)) return id;
    }
  }

  const sign = (body: string) => createHmac("sha256", secret).update(body).digest("base64url");
  const activeAdmins = () => users.filter((u) => u.role === "admin" && !u.disabled);

  return {
    backend: backend.describe,
    get empty() { return users.length === 0; },
    list() { return users.map(publicAccount); },
    get(id: string) { const u = byId(id); return u && publicAccount(u); },
    findRa(raId: string) {
      const id = normalizeRaId(raId);
      const u = id ? byRa(id) : undefined;
      return u && !u.disabled ? publicAccount(u) : undefined;
    },

    async create(input: { username: string; displayName?: string; password: string; role: Role }) {
      const username = String(input.username ?? "").trim().toLowerCase();
      if (!USERNAME.test(username)) throw new AccountError(400, "Usernames are 3-32 characters: letters, digits, dot, dash or underscore.");
      if (byUsername(username)) throw new AccountError(409, "That username is already taken.");
      const problem = checkPassword(input.password);
      if (problem) throw new AccountError(400, problem);
      if (input.role !== "admin" && input.role !== "ra") throw new AccountError(400, "Choose the admin or RA user role.");
      const account: Account = {
        id: randomBytes(9).toString("base64url"),
        username,
        displayName: cleanName(input.displayName ?? "") || username,
        role: input.role,
        raId: newRaId(),
        disabled: false,
        createdAt: clock(),
        version: 1,
        ...(await hashPassword(input.password)),
      };
      users.push(account);
      await persist();
      return publicAccount(account);
    },

    async update(id: string, change: { displayName?: string; role?: Role; disabled?: boolean; password?: string }, actorId?: string) {
      const u = byId(id);
      if (!u) throw new AccountError(404, "That user no longer exists.");
      const demoting = (change.role === "ra" && u.role === "admin") || (change.disabled === true && u.role === "admin" && !u.disabled);
      if (demoting && activeAdmins().length <= 1) throw new AccountError(409, "Keep at least one active admin.");
      if (actorId === id && (change.disabled === true || change.role === "ra")) throw new AccountError(409, "You cannot disable or demote your own account.");
      if (change.password !== undefined) {
        const problem = checkPassword(change.password);
        if (problem) throw new AccountError(400, problem);
        Object.assign(u, await hashPassword(change.password));
        u.version += 1;
      }
      if (change.displayName !== undefined) u.displayName = cleanName(change.displayName) || u.username;
      if (change.role !== undefined) {
        if (change.role !== "admin" && change.role !== "ra") throw new AccountError(400, "Choose the admin or RA user role.");
        u.role = change.role;
      }
      if (change.disabled !== undefined && change.disabled !== u.disabled) {
        u.disabled = change.disabled;
        u.version += 1;
      }
      await persist();
      return publicAccount(u);
    },

    async remove(id: string, actorId?: string) {
      const u = byId(id);
      if (!u) throw new AccountError(404, "That user no longer exists.");
      if (actorId === id) throw new AccountError(409, "You cannot delete your own account.");
      if (u.role === "admin" && !u.disabled && activeAdmins().length <= 1) throw new AccountError(409, "Keep at least one active admin.");
      users.splice(users.indexOf(u), 1);
      await persist();
      return publicAccount(u);
    },

    async changePassword(id: string, current: string, next: string) {
      const u = byId(id);
      if (!u) throw new AccountError(404, "That user no longer exists.");
      const key = await scrypt(String(current ?? ""), Buffer.from(u.salt, "base64"), 32, SCRYPT);
      if (!timingSafeEqual(key, Buffer.from(u.hash, "base64"))) throw new AccountError(403, "The current password is not correct.");
      const problem = checkPassword(next);
      if (problem) throw new AccountError(400, problem);
      Object.assign(u, await hashPassword(next));
      u.version += 1;
      await persist();
      return publicAccount(u);
    },

    async verify(username: string, password: string) {
      const u = byUsername(String(username ?? "").trim());
      const salt = Buffer.from(u?.salt ?? dummy.salt, "base64");
      const key = await scrypt(String(password ?? ""), salt, 32, SCRYPT);
      const ok = timingSafeEqual(key, Buffer.from(u?.hash ?? dummy.hash, "base64"));
      if (!u || !ok) return undefined;
      if (u.disabled) throw new AccountError(403, "This account is disabled. Ask an admin to enable it.");
      u.lastLoginAt = clock();
      void persist().catch(() => {});
      return publicAccount(u);
    },

    issue(id: string) {
      const u = byId(id);
      if (!u) throw new AccountError(404, "That user no longer exists.");
      const body = `v1.${u.id}.${clock().toString(36)}.${u.version}`;
      return `${body}.${sign(body)}`;
    },

    // Returns the account a login token belongs to, if it is still valid.
    session(token: string | undefined) {
      if (!token || token.length > 200) return undefined;
      const parts = token.split(".");
      if (parts.length !== 5 || parts[0] !== "v1") return undefined;
      const body = parts.slice(0, 4).join(".");
      const expected = Buffer.from(sign(body));
      const given = Buffer.from(parts[4]);
      if (expected.length !== given.length || !timingSafeEqual(expected, given)) return undefined;
      const issued = parseInt(parts[2], 36);
      if (!Number.isFinite(issued) || clock() - issued > loginTTL || issued - clock() > 60_000) return undefined;
      const u = byId(parts[1]);
      if (!u || u.disabled || String(u.version) !== parts[3]) return undefined;
      return publicAccount(u);
    },

    flush() { return writing; },
  };
}

export type Accounts = Awaited<ReturnType<typeof createAccounts>>;

// Recent portal events for the admin console. Kept in memory only.
export type Activity = { at: number; kind: string; actor?: string; text: string };

export function createActivityLog(limit = 300, clock = Date.now) {
  const items: Activity[] = [];
  return {
    add(kind: string, text: string, actor?: string) {
      items.unshift({ at: clock(), kind, actor, text: text.slice(0, 200) });
      if (items.length > limit) items.length = limit;
    },
    list(max = 100) { return items.slice(0, max); },
  };
}
