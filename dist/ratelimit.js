/** Returns true if the call is allowed (and counts it), false if the limit is already reached. */
export async function hit(db, key, windowMinutes, limit) {
    const now = Date.now();
    const row = await db.prepare("SELECT window_start, count FROM rate_limits WHERE key = ?").bind(key)
        .first();
    const windowStart = row ? Date.parse(row.window_start) : 0;
    if (!row || now - windowStart > windowMinutes * 60_000) {
        await db.prepare("INSERT OR REPLACE INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)")
            .bind(key, new Date(now).toISOString()).run();
        return true;
    }
    if (row.count >= limit)
        return false;
    await db.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").bind(key).run();
    return true;
}
export async function sweepRateLimits(db) {
    await db.prepare("DELETE FROM rate_limits WHERE window_start < datetime('now','-1 day')").run();
}
