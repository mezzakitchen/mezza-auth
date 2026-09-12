import { describe, it, expect } from "vitest";
import { ShimDb } from "./d1-shim";
import { issueCode, verifyCode } from "../src/codes";
import { DEFAULT_CODE_POLICY } from "../src/types";

const P = "pepper-test";
const E = "peter.nahas@mezzarestaurant.com";

describe("one-time codes", () => {
  it("valid code signs in and is single-use", async () => {
    const db = new ShimDb();
    const { code } = await issueCode(db, P, E, DEFAULT_CODE_POLICY);
    expect(code).toMatch(/^\d{6}$/);
    expect((await verifyCode(db, P, E, code, DEFAULT_CODE_POLICY)).ok).toBe(true);
    const again = await verifyCode(db, P, E, code, DEFAULT_CODE_POLICY);
    expect(again).toEqual({ ok: false, reason: "no_code" });
  });

  it("stores only a hash, never the code", async () => {
    const db = new ShimDb();
    const { code } = await issueCode(db, P, E, DEFAULT_CODE_POLICY);
    const rows = db.raw.prepare("SELECT code_hash FROM login_codes").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0].code_hash).not.toContain(code);
  });

  it("wrong code is rejected and counted", async () => {
    const db = new ShimDb();
    const { code } = await issueCode(db, P, E, DEFAULT_CODE_POLICY);
    const wrong = code === "000000" ? "000001" : "000000";
    expect(await verifyCode(db, P, E, wrong, DEFAULT_CODE_POLICY)).toEqual({ ok: false, reason: "mismatch" });
    expect((await verifyCode(db, P, E, code, DEFAULT_CODE_POLICY)).ok).toBe(true);
  });

  it("expired code is refused", async () => {
    const db = new ShimDb();
    const { code } = await issueCode(db, P, E, DEFAULT_CODE_POLICY);
    db.age("login_codes", "expires_at", 11);
    expect(await verifyCode(db, P, E, code, DEFAULT_CODE_POLICY)).toEqual({ ok: false, reason: "no_code" });
  });

  it("the A/B case: two codes requested, the FIRST one still works", async () => {
    const db = new ShimDb();
    const a = await issueCode(db, P, E, DEFAULT_CODE_POLICY);
    const b = await issueCode(db, P, E, DEFAULT_CODE_POLICY);
    expect(a.code).not.toBe(b.code);
    expect((await verifyCode(db, P, E, a.code, DEFAULT_CODE_POLICY)).ok).toBe(true);
    // success retires every live code, so B is now dead too
    expect(await verifyCode(db, P, E, b.code, DEFAULT_CODE_POLICY)).toEqual({ ok: false, reason: "no_code" });
  });

  it("the newest code always works too", async () => {
    const db = new ShimDb();
    await issueCode(db, P, E, DEFAULT_CODE_POLICY);
    const b = await issueCode(db, P, E, DEFAULT_CODE_POLICY);
    expect((await verifyCode(db, P, E, b.code, DEFAULT_CODE_POLICY)).ok).toBe(true);
  });

  it("never more than maxLive codes alive; the oldest is retired", async () => {
    const db = new ShimDb();
    const a = await issueCode(db, P, E, DEFAULT_CODE_POLICY);
    await issueCode(db, P, E, DEFAULT_CODE_POLICY);
    await issueCode(db, P, E, DEFAULT_CODE_POLICY);
    const d = await issueCode(db, P, E, DEFAULT_CODE_POLICY);
    const live = db.raw.prepare("SELECT count(*) AS n FROM login_codes WHERE consumed_at IS NULL").get() as any;
    expect(live.n).toBe(DEFAULT_CODE_POLICY.maxLive);
    expect((await verifyCode(db, P, E, a.code, DEFAULT_CODE_POLICY)).ok).toBe(false);
    expect((await verifyCode(db, P, E, d.code, DEFAULT_CODE_POLICY)).ok).toBe(true);
  });

  it("brute force: wrong guesses across all live codes lock the email", async () => {
    const db = new ShimDb();
    const a = await issueCode(db, P, E, DEFAULT_CODE_POLICY);
    await issueCode(db, P, E, DEFAULT_CODE_POLICY);
    let locked = false;
    for (let i = 0; i < DEFAULT_CODE_POLICY.maxAttemptsPerEmail; i++) {
      const guess = String(900000 + i);
      const r = await verifyCode(db, P, E, guess === a.code ? "899999" : guess, DEFAULT_CODE_POLICY);
      if (!r.ok && r.reason === "locked") { locked = true; break; }
    }
    expect(locked).toBe(true);
    // and the real code is dead now
    expect((await verifyCode(db, P, E, a.code, DEFAULT_CODE_POLICY)).ok).toBe(false);
    // a fresh request starts clean
    const c = await issueCode(db, P, E, DEFAULT_CODE_POLICY);
    expect((await verifyCode(db, P, E, c.code, DEFAULT_CODE_POLICY)).ok).toBe(true);
  });

  it("codes are per email — a code for one address is useless for another", async () => {
    const db = new ShimDb();
    const { code } = await issueCode(db, P, E, DEFAULT_CODE_POLICY);
    await issueCode(db, P, "tony.nahas@mezzarestaurant.com", DEFAULT_CODE_POLICY);
    expect((await verifyCode(db, P, "tony.nahas@mezzarestaurant.com", code, DEFAULT_CODE_POLICY)).ok).toBe(false);
  });

  it("a different pepper invalidates every stored hash", async () => {
    const db = new ShimDb();
    const { code } = await issueCode(db, P, E, DEFAULT_CODE_POLICY);
    expect((await verifyCode(db, "other-pepper", E, code, DEFAULT_CODE_POLICY)).ok).toBe(false);
  });
});
