/**
 * Hono glue: the JSON endpoints, the session middleware, CSRF and security headers, and the optional
 * hostname hand-off. The host application supplies `findUser` / `loadUser` (its directory) and, if it
 * wants, `authorize` — this file never decides who may use what.
 */
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import type { AuthUser, CodePolicy, CookiePolicy, Db, RateLimits, SessionPolicy } from "./types.js";
import { type MailConfig } from "./email.js";
export interface AppInfo {
    /** Stable id the application uses for authorisation, e.g. "sales". */
    id: string;
    /** Shown in emails and on the login page, e.g. "Mezza Sales Scorecard". */
    name: string;
    /** The hostname this request arrived on. Sessions are pinned to it. */
    host: string;
}
export interface AuthConfig<Env, User extends AuthUser> {
    db: (env: Env) => Db;
    pepper: (env: Env) => string;
    cookie: (env: Env) => CookiePolicy;
    mail: (env: Env) => MailConfig;
    /** Which application is this request for? null → not one of ours (404). */
    app: (req: Request, env: Env) => AppInfo | null;
    /** The directory lookup. Return null for unknown addresses; `active:false` for deactivated ones. */
    findUser: (db: Db, email: string, app: AppInfo, env: Env) => Promise<User | null>;
    loadUser: (db: Db, userId: string, env: Env) => Promise<User | null>;
    /** What `/me` returns for a user. Keep it small; never include secrets. */
    publicUser?: (user: User, app: AppInfo, db: Db, env: Env) => Promise<unknown> | unknown;
    onLogin?: (db: Db, user: User, app: AppInfo, req: Request, env: Env) => Promise<void>;
    /** Value the browser must send in X-Requested-With on every state-changing call. */
    csrfMarker: string;
    codes?: Partial<CodePolicy>;
    limits?: Partial<RateLimits>;
    session?: Partial<SessionPolicy>;
    /**
     * Optional hand-off between hostnames of this Worker. `hubHost` mints tokens for `allowedHosts`.
     * Leave undefined for a single-host application like Ops.
     */
    sso?: {
        hubHost: string | ((env: Env) => string);
        allowedHosts: (env: Env) => string[];
        ttlSeconds?: number;
    };
}
export interface AuthContext<User extends AuthUser> {
    sessionId: string;
    token: string;
    user: User;
    app: AppInfo;
}
export declare function createAuth<Env, User extends AuthUser>(cfg: AuthConfig<Env, User>): {
    routes: Hono<any, import("hono/types").BlankSchema, "/">;
    requireSession: MiddlewareHandler;
    getSession: (c: Context<any>) => Promise<AuthContext<User> | null>;
    csrf: MiddlewareHandler;
    securityHeaders: MiddlewareHandler;
    sweep: (db: Db) => Promise<void>;
    policies: {
        codes: CodePolicy;
        limits: RateLimits;
        session: SessionPolicy;
    };
    clearCookieHeader: (env: Env) => string;
    revokeUserSessions: (db: Db, userId: string) => Promise<void>;
};
