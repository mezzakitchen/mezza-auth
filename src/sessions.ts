/**
 * Opaque sessions. The cookie carries 32 random bytes; the database stores only SHA-256 of them, so a
 * database read-out gives nobody a usable cookie. A session is pinned to the hostname it was created on.
 */
import type { Db, SessionPolicy } from "./types.js";
import { nowIso, plusDays, randomToken, sha256Hex } from "./util.js";

export interface SessionRow { id: string; user_id: string; host: string | null; created_at: string; expires_at: string; last_seen_at: string | null; user_agent: string | null; ip: string | null }

export async function createSession(db: Db, opts: {
  userId: string; host: string; isDevice?: boolean; req?: Request; policy: SessionPolicy;
}): Promise<{ token: string; id: string; expiresAt: string; maxAgeSeconds: number }> {
  const token = randomToken(32);
  const id = await sha256Hex(token);
  const days = opts.isDevice ? opts.policy.deviceDays : opts.policy.days;
  const expiresAt = plusDays(days);
  await db.prepare(
    "INSERT INTO sessions (id, user_id, host, expires_at, last_seen_at, user_agent, ip) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, opts.userId, opts.host.toLowerCase(), expiresAt, nowIso(),
    (opts.req?.headers.get("user-agent") ?? "").slice(0, 200) || null,
    opts.req?.headers.get("CF-Connecting-IP") ?? null).run();
  return { token, id, expiresAt, maxAgeSeconds: days * 86_400 };
}

/**
 * Resolve a cookie token to a session row, enforcing absolute expiry, idle expiry and hostname.
 * Returns null (and deletes the row) on any failure. The caller joins to its own users table.
 */
export async function loadSession(db: Db, token: string | null, host: string, policy: SessionPolicy): Promise<SessionRow | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const id = await sha256Hex(token);
  const row = await db.prepare("SELECT id, user_id, host, created_at, expires_at, last_seen_at, user_agent, ip FROM sessions WHERE id = ?")
    .bind(id).first<SessionRow>();
  if (!row) return null;
  const now = Date.now();
  const idleMs = policy.idleDays > 0 ? policy.idleDays * 86_400_000 : Infinity;
  const lastSeen = row.last_seen_at ? Date.parse(row.last_seen_at) : Date.parse(row.created_at);
  const hostOk = row.host === null || row.host === host.toLowerCase(); // null = pre-migration Ops rows
  if (Date.parse(row.expires_at) < now || now - lastSeen > idleMs || !hostOk) {
    await db.prepare("DELETE FROM sessions WHERE id = ?").bind(id).run();
    return null;
  }
  if (!row.last_seen_at || now - Date.parse(row.last_seen_at) > policy.touchEveryMinutes * 60_000) {
    await db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id = ?").bind(nowIso(), id).run();
  }
  return row;
}

export async function destroySessionByToken(db: Db, token: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE id = ?").bind(await sha256Hex(token)).run();
}

export async function revokeUserSessions(db: Db, userId: string): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
}

export async function sweepSessions(db: Db, policy: SessionPolicy): Promise<void> {
  await db.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(nowIso()).run();
  if (policy.idleDays > 0) {
    await db.prepare("DELETE FROM sessions WHERE COALESCE(last_seen_at, created_at) < ?")
      .bind(new Date(Date.now() - policy.idleDays * 86_400_000).toISOString()).run();
  }
}
