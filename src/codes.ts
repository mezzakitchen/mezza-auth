/**
 * One-time login codes.
 *
 * Storage: `login_codes` — the code is never stored, only SHA-256(code:email:pepper). Several codes can
 * be live for one email at once (see CodePolicy.maxLive); any live one is accepted; a success retires
 * them all; too many wrong guesses across the set retires them all.
 */
import type { CodePolicy, Db } from "./types.js";
import { newId, nowIso, plusMinutes, randomDigits, safeEqual, sha256Hex } from "./util.js";

export async function hashCode(pepper: string, email: string, code: string): Promise<string> {
  return sha256Hex(`${code}:${email}:${pepper}`);
}

interface LiveCode { id: string; code_hash: string; expires_at: string; attempts: number; created_at: string }

async function liveCodes(db: Db, email: string): Promise<LiveCode[]> {
  // Expired-but-unconsumed rows are retired here as housekeeping, so "live" means exactly that.
  await db.prepare("UPDATE login_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL AND expires_at < ?")
    .bind(nowIso(), email, nowIso()).run();
  const rows = await db.prepare(
    `SELECT id, code_hash, expires_at, attempts, created_at FROM login_codes
      WHERE email = ? AND consumed_at IS NULL ORDER BY created_at DESC, rowid DESC`
  ).bind(email).all<LiveCode>();
  return rows.results;
}

/**
 * Mint a code for an email that the host application has already decided is allowed to receive one.
 * Returns the plaintext code exactly once — the caller emails it and forgets it.
 */
export async function issueCode(db: Db, pepper: string, email: string, policy: CodePolicy): Promise<{ code: string; id: string; expiresAt: string }> {
  const live = await liveCodes(db, email);
  // Keep at most maxLive-1 older codes so the new one fits. Oldest go first.
  const excess = live.length - (policy.maxLive - 1);
  if (excess > 0) {
    const oldest = live.slice(live.length - excess);
    for (const row of oldest) {
      await db.prepare("UPDATE login_codes SET consumed_at = ? WHERE id = ?").bind(nowIso(), row.id).run();
    }
  }
  const code = randomDigits(policy.digits);
  const id = newId("lc");
  const expiresAt = plusMinutes(policy.ttlMinutes);
  await db.prepare("INSERT INTO login_codes (id, email, code_hash, expires_at) VALUES (?, ?, ?, ?)")
    .bind(id, email, await hashCode(pepper, email, code), expiresAt).run();
  return { code, id, expiresAt };
}

/** Burn roughly the same CPU as a real issue so the response time does not reveal whether the email exists. */
export async function burnLikeIssue(pepper: string, email: string): Promise<void> {
  await hashCode(pepper, email, "000000");
}

export type VerifyResult =
  | { ok: true; codeId: string }
  | { ok: false; reason: "no_code" | "locked" | "mismatch" };

export async function verifyCode(db: Db, pepper: string, email: string, code: string, policy: CodePolicy): Promise<VerifyResult> {
  const live = await liveCodes(db, email);
  if (live.length === 0) return { ok: false, reason: "no_code" };

  const attempts = live.reduce((n, r) => n + r.attempts, 0);
  if (attempts >= policy.maxAttemptsPerEmail) {
    await retireAll(db, email);
    return { ok: false, reason: "locked" };
  }

  const candidate = await hashCode(pepper, email, code);
  const match = live.find((r) => safeEqual(r.code_hash, candidate));
  if (match) {
    await retireAll(db, email);
    return { ok: true, codeId: match.id };
  }
  // Count the miss against the newest code; the lock check sums across all live codes.
  await db.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?").bind(live[0]!.id).run();
  if (attempts + 1 >= policy.maxAttemptsPerEmail) {
    await retireAll(db, email);
    return { ok: false, reason: "locked" };
  }
  return { ok: false, reason: "mismatch" };
}

async function retireAll(db: Db, email: string): Promise<void> {
  await db.prepare("UPDATE login_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL").bind(nowIso(), email).run();
}

export async function sweepCodes(db: Db): Promise<void> {
  await db.prepare("DELETE FROM login_codes WHERE created_at < datetime('now','-1 day')").run();
}
