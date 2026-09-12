import { newId, nowIso, plusMinutes, randomDigits, safeEqual, sha256Hex } from "./util.js";
export async function hashCode(pepper, email, code) {
    return sha256Hex(`${code}:${email}:${pepper}`);
}
async function liveCodes(db, email) {
    // Expired-but-unconsumed rows are retired here as housekeeping, so "live" means exactly that.
    await db.prepare("UPDATE login_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL AND expires_at < ?")
        .bind(nowIso(), email, nowIso()).run();
    const rows = await db.prepare(`SELECT id, code_hash, expires_at, attempts, created_at FROM login_codes
      WHERE email = ? AND consumed_at IS NULL ORDER BY created_at DESC, rowid DESC`).bind(email).all();
    return rows.results;
}
/**
 * Mint a code for an email that the host application has already decided is allowed to receive one.
 * Returns the plaintext code exactly once — the caller emails it and forgets it.
 */
export async function issueCode(db, pepper, email, policy) {
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
export async function burnLikeIssue(pepper, email) {
    await hashCode(pepper, email, "000000");
}
export async function verifyCode(db, pepper, email, code, policy) {
    const live = await liveCodes(db, email);
    if (live.length === 0)
        return { ok: false, reason: "no_code" };
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
    await db.prepare("UPDATE login_codes SET attempts = attempts + 1 WHERE id = ?").bind(live[0].id).run();
    if (attempts + 1 >= policy.maxAttemptsPerEmail) {
        await retireAll(db, email);
        return { ok: false, reason: "locked" };
    }
    return { ok: false, reason: "mismatch" };
}
async function retireAll(db, email) {
    await db.prepare("UPDATE login_codes SET consumed_at = ? WHERE email = ? AND consumed_at IS NULL").bind(nowIso(), email).run();
}
export async function sweepCodes(db) {
    await db.prepare("DELETE FROM login_codes WHERE created_at < datetime('now','-1 day')").run();
}
