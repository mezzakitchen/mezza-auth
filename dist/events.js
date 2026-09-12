import { clientIp, newId } from "./util.js";
export async function logEvent(db, type, opts) {
    try {
        await db.prepare("INSERT INTO auth_events (id, type, email, user_id, host, ip, user_agent, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(newId("ae"), type, opts.email ?? null, opts.userId ?? null, opts.host ?? null, opts.req ? clientIp(opts.req) : null, opts.req ? (opts.req.headers.get("user-agent") ?? "").slice(0, 200) : null, opts.detail ?? null).run();
    }
    catch {
        // Logging must never break a login.
    }
}
export async function sweepEvents(db, keepDays = 90) {
    await db.prepare(`DELETE FROM auth_events WHERE created_at < datetime('now', ?)`).bind(`-${keepDays} days`).run();
}
