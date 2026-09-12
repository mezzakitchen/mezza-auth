/**
 * Hono glue: the JSON endpoints, the session middleware, CSRF and security headers, and the optional
 * hostname hand-off. The host application supplies `findUser` / `loadUser` (its directory) and, if it
 * wants, `authorize` — this file never decides who may use what.
 */
import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import type { AuthUser, CodePolicy, CookiePolicy, Db, RateLimits, SessionPolicy } from "./types.js";
import { DEFAULT_CODE_POLICY, DEFAULT_RATE_LIMITS, DEFAULT_SESSION_POLICY } from "./types.js";
import { burnLikeIssue, issueCode, sweepCodes, verifyCode } from "./codes.js";
import { createSession, destroySessionByToken, loadSession, revokeUserSessions, sweepSessions } from "./sessions.js";
import { cookieHeader, readCookie } from "./cookies.js";
import { deliver, loginCodeEmail, type MailConfig } from "./email.js";
import { hit, sweepRateLimits } from "./ratelimit.js";
import { logEvent, sweepEvents } from "./events.js";
import { issueHandoff, redeemHandoff, sweepHandoffs } from "./sso.js";
import { clientIp, normaliseEmail } from "./util.js";

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
  sso?: { hubHost: string | ((env: Env) => string); allowedHosts: (env: Env) => string[]; ttlSeconds?: number };
}

export interface AuthContext<User extends AuthUser> { sessionId: string; token: string; user: User; app: AppInfo }

export function createAuth<Env, User extends AuthUser>(cfg: AuthConfig<Env, User>) {
  const codes: CodePolicy = { ...DEFAULT_CODE_POLICY, ...cfg.codes };
  const limits: RateLimits = { ...DEFAULT_RATE_LIMITS, ...cfg.limits };
  const session: SessionPolicy = { ...DEFAULT_SESSION_POLICY, ...cfg.session };

  const generic = { ok: true, message: "If that email is registered, a code is on its way." };
  const badCode = "That code is not valid or has expired. Request a new one.";

  /** Resolve the current session, or null. Never throws. */
  async function getSession(c: Context<any>): Promise<AuthContext<User> | null> {
    const env = c.env as Env;
    const app = cfg.app(c.req.raw, env);
    if (!app) return null;
    const db = cfg.db(env);
    const cookie = cfg.cookie(env);
    const token = readCookie(c.req.raw, cookie.name);
    const row = await loadSession(db, token, app.host, session);
    if (!row || !token) return null;
    const user = await cfg.loadUser(db, row.user_id, env);
    if (!user || !user.active) {
      await db.prepare("DELETE FROM sessions WHERE id = ?").bind(row.id).run();
      return null;
    }
    return { sessionId: row.id, token, user, app };
  }

  /** 401 JSON when there is no session; sets c.var.auth otherwise. For API routes. */
  const requireSession: MiddlewareHandler = async (c, next) => {
    const auth = await getSession(c);
    if (!auth) return c.json({ error: "Sign in required" }, 401);
    c.set("auth", auth);
    await next();
  };

  /**
   * CSRF: state-changing requests must come from a page on this very hostname (Origin, when present,
   * must match Host) and carry the marker header a cross-site form cannot add.
   */
  const csrf: MiddlewareHandler = async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      const host = new URL(c.req.url).host.toLowerCase();
      let originHost: string | null = null;
      if (origin) { try { originHost = new URL(origin).host.toLowerCase(); } catch { originHost = "invalid"; } }
      const okOrigin = !origin || (originHost !== null && originHost === host);
      const marker = c.req.header("x-requested-with") === cfg.csrfMarker;
      if (!okOrigin || !marker) return c.json({ error: "Cross-site request blocked" }, 403);
    }
    await next();
  };

  const securityHeaders: MiddlewareHandler = async (c, next) => {
    await next();
    c.header("X-Content-Type-Options", "nosniff");
    c.header("Referrer-Policy", "same-origin");
    c.header("X-Frame-Options", "DENY");
    c.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    c.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    c.header("Cache-Control", "no-store");
  };

  const routes = new Hono<any>();
  routes.use("*", csrf);

  routes.post("/request-code", async (c) => {
    const env = c.env as Env;
    const app = cfg.app(c.req.raw, env);
    if (!app) return c.json({ error: "Not found" }, 404);
    const db = cfg.db(env);
    const body = await c.req.json().catch(() => ({})) as any;
    const email = normaliseEmail(body?.email);
    if (!email) return c.json(generic);

    const ipOk = await hit(db, `ip:${clientIp(c.req.raw)}`, limits.windowMinutes, limits.requestPerIp);
    // Per application, so signing in to four dashboards in a row is not "too many"; plus a ceiling per
    // address across every application, so one address cannot be flooded through all of them.
    const emailOk = (await hit(db, `email:${app.id}:${email}`, limits.windowMinutes, limits.requestPerEmail))
      && (await hit(db, `email-all:${email}`, limits.windowMinutes, limits.requestPerEmailAllApps));
    const user = ipOk && emailOk ? await cfg.findUser(db, email, app, env) : null;

    if (!ipOk || !emailOk || !user || !user.active) {
      await burnLikeIssue(cfg.pepper(env), email);
      await logEvent(db, "code_refused", { email, host: app.host, req: c.req.raw,
        detail: !ipOk ? "ip_limit" : !emailOk ? "email_limit" : !user ? "unknown" : "inactive" });
      // Same body, same status, same work for every outcome.
      return c.json(generic);
    }

    const { code } = await issueCode(db, cfg.pepper(env), email, codes);
    const mail = loginCodeEmail({ code, ttlMinutes: codes.ttlMinutes, appName: app.name, siteHost: app.host });
    const res = await deliver(cfg.mail(env), { to: email, ...mail });
    await logEvent(db, res.ok ? "code_sent" : "code_send_failed", { email, userId: user.id, host: app.host, req: c.req.raw,
      detail: res.ok ? `${res.provider}:${res.id ?? ""}` : `${res.provider}:${res.error ?? "unknown"}` });
    return c.json(generic);
  });

  routes.post("/verify", async (c) => {
    const env = c.env as Env;
    const app = cfg.app(c.req.raw, env);
    if (!app) return c.json({ error: "Not found" }, 404);
    const db = cfg.db(env);
    const body = await c.req.json().catch(() => ({})) as any;
    const email = normaliseEmail(body?.email);
    const code = typeof body?.code === "string" ? body.code.trim() : "";
    if (!email || !new RegExp(`^\\d{${codes.digits}}$`).test(code)) {
      return c.json({ ok: false, error: `Enter your email and the ${codes.digits}-digit code.` }, 400);
    }
    if (!(await hit(db, `verify:${clientIp(c.req.raw)}`, limits.windowMinutes, limits.verifyPerIp))) {
      return c.json({ ok: false, error: "Too many attempts. Try again later." }, 429);
    }
    const result = await verifyCode(db, cfg.pepper(env), email, code, codes);
    if (!result.ok) {
      await logEvent(db, result.reason === "locked" ? "verify_locked" : "verify_failed", { email, host: app.host, req: c.req.raw, detail: result.reason });
      return c.json({ ok: false, error: badCode }, 401);
    }
    const user = await cfg.findUser(db, email, app, env);
    if (!user || !user.active) {
      await logEvent(db, "verify_failed", { email, host: app.host, req: c.req.raw, detail: "user_missing_after_verify" });
      return c.json({ ok: false, error: badCode }, 401);
    }
    const s = await createSession(db, { userId: user.id, host: app.host, isDevice: user.kind === "device", req: c.req.raw, policy: session });
    if (cfg.onLogin) await cfg.onLogin(db, user, app, c.req.raw, env);
    await logEvent(db, "verify_ok", { email, userId: user.id, host: app.host, req: c.req.raw });
    c.header("Set-Cookie", cookieHeader(cfg.cookie(env), s.token, s.maxAgeSeconds));
    return c.json({ ok: true, expires_at: s.expiresAt });
  });

  routes.post("/logout", async (c) => {
    const env = c.env as Env;
    const db = cfg.db(env);
    const cookie = cfg.cookie(env);
    const token = readCookie(c.req.raw, cookie.name);
    if (token) {
      await destroySessionByToken(db, token);
      await logEvent(db, "logout", { host: cfg.app(c.req.raw, env)?.host ?? null, req: c.req.raw });
    }
    c.header("Set-Cookie", cookieHeader(cookie, "", 0));
    return c.json({ ok: true });
  });

  routes.get("/me", async (c) => {
    const auth = await getSession(c);
    if (!auth) return c.json({ error: "Sign in required" }, 401);
    const env = c.env as Env;
    const pub = cfg.publicUser ? await cfg.publicUser(auth.user, auth.app, cfg.db(env), env) : { id: auth.user.id, email: auth.user.email };
    return c.json({ user: pub, app: { id: auth.app.id, name: auth.app.name, host: auth.app.host } });
  });

  // ── Hand-off between hostnames (opt-in) ─────────────────────────────
  if (cfg.sso) {
    const sso = cfg.sso;
    const ttl = sso.ttlSeconds ?? 60;

    /** On the hub: mint a token for a sibling host if the person is signed in here; otherwise bounce them back. */
    routes.get("/sso", async (c) => {
      const env = c.env as Env;
      const here = new URL(c.req.url).host.toLowerCase();
      const hubHost = (typeof sso.hubHost === "function" ? sso.hubHost(env) : sso.hubHost).toLowerCase();
      if (here !== hubHost) return c.json({ error: "Not found" }, 404);
      const to = c.req.query("to") ?? "";
      let target: URL;
      try { target = new URL(to); } catch { return c.text("Bad destination", 400); }
      const allowed = sso.allowedHosts(env).map((h) => h.toLowerCase());
      if (target.protocol !== "https:" || !allowed.includes(target.host.toLowerCase())) return c.text("Bad destination", 400);
      const db = cfg.db(env);
      const auth = await getSession(c);
      if (!auth) {
        target.searchParams.set("sso", "none");
        return c.redirect(target.toString(), 302);
      }
      const token = await issueHandoff(db, auth.user.id, target.host, ttl);
      await logEvent(db, "sso_issued", { userId: auth.user.id, host: here, req: c.req.raw, detail: target.host });
      const cb = new URL(`https://${target.host}${c.req.path.replace(/\/sso$/, "/callback")}`);
      cb.searchParams.set("t", token);
      cb.searchParams.set("next", target.pathname + target.search);
      return c.redirect(cb.toString(), 302);
    });

    /** On the destination: redeem once, create a host-only session, continue to the page asked for. */
    routes.get("/callback", async (c) => {
      const env = c.env as Env;
      const app = cfg.app(c.req.raw, env);
      if (!app) return c.json({ error: "Not found" }, 404);
      const db = cfg.db(env);
      const token = c.req.query("t") ?? "";
      const next = c.req.query("next") ?? "/";
      const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
      const dest = new URL(`https://${app.host}${safeNext}`);
      const userId = await redeemHandoff(db, token, app.host);
      const user = userId ? await cfg.loadUser(db, userId, env) : null;
      if (!userId || !user || !user.active) {
        await logEvent(db, "sso_rejected", { userId, host: app.host, req: c.req.raw });
        dest.searchParams.set("sso", "none");
        return c.redirect(dest.toString(), 302);
      }
      const s = await createSession(db, { userId: user.id, host: app.host, isDevice: user.kind === "device", req: c.req.raw, policy: session });
      if (cfg.onLogin) await cfg.onLogin(db, user, app, c.req.raw, env);
      await logEvent(db, "sso_redeemed", { userId: user.id, email: user.email, host: app.host, req: c.req.raw });
      c.header("Set-Cookie", cookieHeader(cfg.cookie(env), s.token, s.maxAgeSeconds));
      return c.redirect(dest.toString(), 302);
    });
  }

  /** Housekeeping for a scheduled() handler. */
  async function sweep(db: Db): Promise<void> {
    await sweepSessions(db, session);
    await sweepCodes(db);
    await sweepRateLimits(db);
    await sweepHandoffs(db);
    await sweepEvents(db);
  }

  return {
    routes, requireSession, getSession, csrf, securityHeaders, sweep,
    policies: { codes, limits, session },
    clearCookieHeader: (env: Env) => cookieHeader(cfg.cookie(env), "", 0),
    revokeUserSessions: (db: Db, userId: string) => revokeUserSessions(db, userId),
  };
}
