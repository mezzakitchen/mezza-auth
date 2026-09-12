/**
 * The slice of the D1 API this package uses. Declared here so the core can be tested against a
 * SQLite shim and so a consumer could, in principle, back it with something else.
 */
export interface DbStatement {
    bind(...values: unknown[]): DbStatement;
    first<T = Record<string, unknown>>(): Promise<T | null>;
    run(): Promise<unknown>;
    all<T = Record<string, unknown>>(): Promise<{
        results: T[];
    }>;
}
export interface Db {
    prepare(sql: string): DbStatement;
    batch(statements: DbStatement[]): Promise<unknown>;
}
/** What the host application tells us about a person. Nothing more is needed to authenticate. */
export interface AuthUser {
    id: string;
    email: string;
    active: boolean;
    /** "device" = a shared store tablet; gets the long session. Anything else is a person. */
    kind?: "person" | "device" | string;
}
export interface CodePolicy {
    /** Minutes a code stays valid. Ops: 10. */
    ttlMinutes: number;
    /**
     * How many unexpired, unconsumed codes one email may hold at once. Requesting one more retires the
     * oldest. Any live code is accepted, so "I asked twice and typed the first one" works. Ops used 1
     * (newest wins), which is the silent failure this replaces.
     */
    maxLive: number;
    /** Wrong guesses allowed across ALL live codes for an email before they are all retired. */
    maxAttemptsPerEmail: number;
    /** Codes are numeric, this many digits. 6 → one in a million. */
    digits: number;
}
export interface RateLimits {
    /** Window in minutes for the counters below. */
    windowMinutes: number;
    /** request-code calls per IP per window. */
    requestPerIp: number;
    /** request-code calls per email per application per window. */
    requestPerEmail: number;
    /** request-code calls per email across ALL applications served by this Worker, per window. */
    requestPerEmailAllApps: number;
    /** verify calls per IP per window. */
    verifyPerIp: number;
}
export interface SessionPolicy {
    /** Absolute lifetime for people, in days. Ops: 30. */
    days: number;
    /** Absolute lifetime for shared devices, in days. Ops: 180. */
    deviceDays: number;
    /** Idle lifetime in days; a session unused this long is dropped even if its absolute expiry is later. 0 disables. */
    idleDays: number;
    /** How often last_seen_at is written back, in minutes. */
    touchEveryMinutes: number;
}
export interface CookiePolicy {
    /** Cookie name. Different per product (mzops, mzsc) so nothing is ever confused, never shared. */
    name: string;
    /** false only for `wrangler dev` over http. */
    secure: boolean;
    sameSite: "Lax" | "Strict";
    /**
     * Never set by default. A host-only cookie is the whole point: a session for sales.example.com is not
     * sent to consolidated.example.com. Present so the choice is explicit if someone ever needs it.
     */
    domain?: string;
}
export declare const DEFAULT_CODE_POLICY: CodePolicy;
export declare const DEFAULT_RATE_LIMITS: RateLimits;
export declare const DEFAULT_SESSION_POLICY: SessionPolicy;
export type AuthEventType = "code_requested" | "code_refused" | "code_sent" | "code_send_failed" | "verify_ok" | "verify_failed" | "verify_locked" | "logout" | "session_revoked" | "sso_issued" | "sso_redeemed" | "sso_rejected";
