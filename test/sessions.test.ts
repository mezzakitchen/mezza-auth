import { describe, it, expect } from "vitest";
import { ShimDb } from "./d1-shim";
import { createSession, loadSession, destroySessionByToken, revokeUserSessions, sweepSessions } from "../src/sessions";
import { cookieHeader, readCookie } from "../src/cookies";
import { DEFAULT_SESSION_POLICY } from "../src/types";

const POL = DEFAULT_SESSION_POLICY;
const H = "sales.mezzascorecard.com";

describe("sessions", () => {
  it("creates an opaque token and stores only its hash", async () => {
    const db = new ShimDb();
    const s = await createSession(db, { userId: "u1", host: H, policy: POL });
    expect(s.token.length).toBeGreaterThanOrEqual(43);
    const row = db.raw.prepare("SELECT id, host FROM sessions").get() as any;
    expect(row.id).not.toBe(s.token);
    expect(row.id).toMatch(/^[0-9a-f]{64}$/);
    expect(row.host).toBe(H);
    expect((await loadSession(db, s.token, H, POL))?.user_id).toBe("u1");
  });

  it("rejects garbage, short and unknown tokens", async () => {
    const db = new ShimDb();
    expect(await loadSession(db, null, H, POL)).toBeNull();
    expect(await loadSession(db, "short", H, POL)).toBeNull();
    expect(await loadSession(db, "x".repeat(50), H, POL)).toBeNull();
  });

  it("a session for one host is refused on another (and deleted)", async () => {
    const db = new ShimDb();
    const s = await createSession(db, { userId: "u1", host: H, policy: POL });
    expect(await loadSession(db, s.token, "consolidated.mezzascorecard.com", POL)).toBeNull();
    expect(await loadSession(db, s.token, H, POL)).toBeNull(); // gone — replay attempt burned it
  });

  it("absolute expiry", async () => {
    const db = new ShimDb();
    const s = await createSession(db, { userId: "u1", host: H, policy: POL });
    db.age("sessions", "expires_at", 31 * 1440);
    expect(await loadSession(db, s.token, H, POL)).toBeNull();
  });

  it("idle expiry", async () => {
    const db = new ShimDb();
    const s = await createSession(db, { userId: "u1", host: H, policy: POL });
    db.age("sessions", "last_seen_at", 15 * 1440);
    expect(await loadSession(db, s.token, H, POL)).toBeNull();
  });

  it("idle expiry disabled when idleDays = 0", async () => {
    const db = new ShimDb();
    const s = await createSession(db, { userId: "u1", host: H, policy: { ...POL, idleDays: 0 } });
    db.age("sessions", "last_seen_at", 20 * 1440);
    expect(await loadSession(db, s.token, H, { ...POL, idleDays: 0 })).not.toBeNull();
  });

  it("devices get the long session", async () => {
    const db = new ShimDb();
    const s = await createSession(db, { userId: "dev1", host: H, isDevice: true, policy: POL });
    expect(s.maxAgeSeconds).toBe(180 * 86400);
  });

  it("logout destroys exactly that session; revoke-all destroys the user's others", async () => {
    const db = new ShimDb();
    const a = await createSession(db, { userId: "u1", host: H, policy: POL });
    const b = await createSession(db, { userId: "u1", host: H, policy: POL });
    const c = await createSession(db, { userId: "u2", host: H, policy: POL });
    await destroySessionByToken(db, a.token);
    expect(await loadSession(db, a.token, H, POL)).toBeNull();
    expect(await loadSession(db, b.token, H, POL)).not.toBeNull();
    await revokeUserSessions(db, "u1");
    expect(await loadSession(db, b.token, H, POL)).toBeNull();
    expect(await loadSession(db, c.token, H, POL)).not.toBeNull();
  });

  it("sweep removes expired and idle rows", async () => {
    const db = new ShimDb();
    await createSession(db, { userId: "u1", host: H, policy: POL });
    db.age("sessions", "expires_at", 40 * 1440);
    await sweepSessions(db, POL);
    expect((db.raw.prepare("SELECT count(*) n FROM sessions").get() as any).n).toBe(0);
  });

  it("cookie attributes: HttpOnly, Secure, SameSite=Lax, Path=/, host-only", () => {
    const h = cookieHeader({ name: "mzsc", secure: true, sameSite: "Lax" }, "tok", 3600);
    expect(h).toBe("mzsc=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure");
    expect(h).not.toMatch(/Domain=/);
    expect(cookieHeader({ name: "mzsc", secure: true, sameSite: "Lax" }, "", 0)).toContain("Max-Age=0");
    const req = new Request("https://x/", { headers: { cookie: "a=1; mzsc=abc=def; b=2" } });
    expect(readCookie(req, "mzsc")).toBe("abc=def");
    expect(readCookie(req, "zzz")).toBeNull();
  });
});
