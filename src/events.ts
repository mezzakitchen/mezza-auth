/** Append-only log of authentication events — what support looks at when someone says "it didn't work". */
import type { AuthEventType, Db } from "./types.js";
import { clientIp, newId } from "./util.js";

export async function logEvent(db: Db, type: AuthEventType, opts: {
  email?: string | null; userId?: string | null; host?: string | null; req?: Request; detail?: string | null;
}): Promise<void> {
  try {
    await db.prepare(
      "INSERT INTO auth_events (id, type, email, user_id, host, ip, user_agent, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(newId("ae"), type, opts.email ?? null, opts.userId ?? null, opts.host ?? null,
      opts.req ? clientIp(opts.req) : null, opts.req ? (opts.req.headers.get("user-agent") ?? "").slice(0, 200) : null,
      opts.detail ?? null).run();
  } catch {
    // Logging must never break a login.
  }
}

export async function sweepEvents(db: Db, keepDays = 90): Promise<void> {
  await db.prepare(`DELETE FROM auth_events WHERE created_at < datetime('now', ?)`).bind(`-${keepDays} days`).run();
}
