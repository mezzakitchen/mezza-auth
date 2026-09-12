/** Append-only log of authentication events — what support looks at when someone says "it didn't work". */
import type { AuthEventType, Db } from "./types.js";
export declare function logEvent(db: Db, type: AuthEventType, opts: {
    email?: string | null;
    userId?: string | null;
    host?: string | null;
    req?: Request;
    detail?: string | null;
}): Promise<void>;
export declare function sweepEvents(db: Db, keepDays?: number): Promise<void>;
