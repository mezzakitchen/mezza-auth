/**
 * Hand-off between hostnames served by the SAME Worker — how "sign in once on the hub, open any
 * dashboard" works without a shared cookie. The hub mints a single-use token bound to the person and
 * the destination host; the destination redeems it once, within a minute, and creates its own
 * host-only session. Nothing here crosses to another Worker or another database.
 */
import type { Db } from "./types.js";
import { newId, randomToken, sha256Hex } from "./util.js";

export async function issueHandoff(db: Db, userId: string, toHost: string, ttlSeconds = 60): Promise<string> {
  const token = randomToken(32);
  const expires = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  await db.prepare("INSERT INTO sso_tokens (id, token_hash, user_id, to_host, expires_at) VALUES (?, ?, ?, ?, ?)")
    .bind(newId("sso"), await sha256Hex(token), userId, toHost.toLowerCase(), expires).run();
  return token;
}

/** Returns the user id if the token is live, unused and meant for this host; consumes it either way. */
export async function redeemHandoff(db: Db, token: string, host: string): Promise<string | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const hash = await sha256Hex(token);
  const row = await db.prepare("SELECT id, user_id, to_host, expires_at, consumed_at FROM sso_tokens WHERE token_hash = ?")
    .bind(hash).first<{ id: string; user_id: string; to_host: string; expires_at: string; consumed_at: string | null }>();
  if (!row) return null;
  await db.prepare("UPDATE sso_tokens SET consumed_at = ? WHERE id = ?").bind(new Date().toISOString(), row.id).run();
  if (row.consumed_at) return null;
  if (Date.parse(row.expires_at) < Date.now()) return null;
  if (row.to_host !== host.toLowerCase()) return null;
  return row.user_id;
}

export async function sweepHandoffs(db: Db): Promise<void> {
  await db.prepare("DELETE FROM sso_tokens WHERE created_at < datetime('now','-1 day')").run();
}
