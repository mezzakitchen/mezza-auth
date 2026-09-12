/**
 * Opaque sessions. The cookie carries 32 random bytes; the database stores only SHA-256 of them, so a
 * database read-out gives nobody a usable cookie. A session is pinned to the hostname it was created on.
 */
import type { Db, SessionPolicy } from "./types.js";
export interface SessionRow {
    id: string;
    user_id: string;
    host: string | null;
    created_at: string;
    expires_at: string;
    last_seen_at: string | null;
    user_agent: string | null;
    ip: string | null;
}
export declare function createSession(db: Db, opts: {
    userId: string;
    host: string;
    isDevice?: boolean;
    req?: Request;
    policy: SessionPolicy;
}): Promise<{
    token: string;
    id: string;
    expiresAt: string;
    maxAgeSeconds: number;
}>;
/**
 * Resolve a cookie token to a session row, enforcing absolute expiry, idle expiry and hostname.
 * Returns null (and deletes the row) on any failure. The caller joins to its own users table.
 */
export declare function loadSession(db: Db, token: string | null, host: string, policy: SessionPolicy): Promise<SessionRow | null>;
export declare function destroySessionByToken(db: Db, token: string): Promise<void>;
export declare function revokeUserSessions(db: Db, userId: string): Promise<void>;
export declare function sweepSessions(db: Db, policy: SessionPolicy): Promise<void>;
