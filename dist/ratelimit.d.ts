/** Fixed-window counters in D1. Good enough for login abuse; not a DDoS defence (Cloudflare is). */
import type { Db } from "./types.js";
/** Returns true if the call is allowed (and counts it), false if the limit is already reached. */
export declare function hit(db: Db, key: string, windowMinutes: number, limit: number): Promise<boolean>;
export declare function sweepRateLimits(db: Db): Promise<void>;
