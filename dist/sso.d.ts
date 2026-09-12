/**
 * Hand-off between hostnames served by the SAME Worker — how "sign in once on the hub, open any
 * dashboard" works without a shared cookie. The hub mints a single-use token bound to the person and
 * the destination host; the destination redeems it once, within a minute, and creates its own
 * host-only session. Nothing here crosses to another Worker or another database.
 */
import type { Db } from "./types.js";
export declare function issueHandoff(db: Db, userId: string, toHost: string, ttlSeconds?: number): Promise<string>;
/** Returns the user id if the token is live, unused and meant for this host; consumes it either way. */
export declare function redeemHandoff(db: Db, token: string, host: string): Promise<string | null>;
export declare function sweepHandoffs(db: Db): Promise<void>;
