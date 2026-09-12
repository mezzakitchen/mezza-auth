import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { ShimDb } from "./d1-shim";
import { createAuth } from "../src/hono";
import { ConsoleProvider } from "../src/email";
import type { AuthUser } from "../src/types";

interface Env { DB: ShimDb; PEPPER: string; MAIL: ConsoleProvider }

const HUB = "mezzascorecard.com", SALES = "sales.mezzascorecard.com", TRIPOLI = "tripoli.mezzascorecard.com";
const APPS: Record<string, { id: string; name: string }> = {
  [HUB]: { id: "hub", name: "Mezza Scorecard" },
  [SALES]: { id: "sales", name: "Mezza Sales Scorecard" },
  [TRIPOLI]: { id: "tripoli", name: "Tripoli Scorecard" },
};

function build() {
  const db = new ShimDb(`
    CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, name TEXT, is_active INTEGER DEFAULT 1);
    INSERT INTO users VALUES ('u_peter','peter.nahas@mezzarestaurant.com','Peter',1);
    INSERT INTO users VALUES ('u_gone','former@mezzarestaurant.com','Former',0);
  `);
  const mail = new ConsoleProvider();
  const env: Env = { DB: db, PEPPER: "test-pepper", MAIL: mail };
  const auth = createAuth<Env, AuthUser & { name: string }>({
    db: (e) => e.DB,
    pepper: (e) => e.PEPPER,
    cookie: () => ({ name: "mzsc", secure: true, sameSite: "Lax" }),
    mail: (e) => ({ provider: e.MAIL, from: "Mezza Scorecard <scorecard@mezzascorecard.com>" }),
    app: (req) => { const h = new URL(req.url).host; return APPS[h] ? { ...APPS[h]!, host: h } : null; },
    findUser: async (d, email) => {
      const r = await d.prepare("SELECT id, email, name, is_active FROM users WHERE email = ?").bind(email).first<any>();
      return r ? { id: r.id, email: r.email, name: r.name, active: !!r.is_active } : null;
    },
    loadUser: async (d, id) => {
      const r = await d.prepare("SELECT id, email, name, is_active FROM users WHERE id = ?").bind(id).first<any>();
      return r ? { id: r.id, email: r.email, name: r.name, active: !!r.is_active } : null;
    },
    publicUser: (u) => ({ id: u.id, email: u.email, name: u.name }),
    csrfMarker: "mezza-scorecard",
    limits: { windowMinutes: 15, requestPerIp: 30, requestPerEmail: 3, verifyPerIp: 10 },
    sso: { hubHost: HUB, allowedHosts: () => [SALES, TRIPOLI] },
  });
  const app = new Hono<{ Bindings: Env }>();
  app.use("*", auth.securityHeaders);
  app.route("/auth", auth.routes);
  app.get("/api/secret", auth.requireSession, (c) => c.json({ secret: true, who: ((c as any).get("auth") as any).user.email }));
  app.get("/", async (c) => { const s = await auth.getSession(c); return s ? c.text(`page for ${s.user.email}`) : c.text("login", 401); });
  return { app, env, db, mail, auth };
}

const H = { "content-type": "application/json", "x-requested-with": "mezza-scorecard" };
const post = (app: Hono<any>, env: Env, host: string, path: string, body: unknown, extra: Record<string, string> = {}, ip = "1.1.1.1") =>
  app.request(`https://${host}${path}`, { method: "POST", headers: { ...H, origin: `https://${host}`, "CF-Connecting-IP": ip, ...extra }, body: JSON.stringify(body) }, env);
const get = (app: Hono<any>, env: Env, host: string, path: string, cookie?: string) =>
  app.request(`https://${host}${path}`, { headers: cookie ? { cookie } : {}, redirect: "manual" }, env);
const lastCode = (mail: ConsoleProvider) => mail.sent.at(-1)!.subject.match(/^(\d{6})/)![1]!;
const cookieOf = (res: Response) => res.headers.get("set-cookie")!.split(";")[0]!;

describe("auth routes", () => {
  let t: ReturnType<typeof build>;
  beforeEach(() => { t = build(); });

  it("full happy path: request → email → verify → cookie → protected page", async () => {
    const r1 = await post(t.app, t.env, SALES, "/auth/request-code", { email: "Peter.Nahas@mezzarestaurant.com " });
    expect(r1.status).toBe(200);
    expect(t.mail.sent).toHaveLength(1);
    expect(t.mail.sent[0]!.to).toBe("peter.nahas@mezzarestaurant.com");
    expect(t.mail.sent[0]!.subject).toMatch(/^\d{6} is your Mezza Sales Scorecard sign-in code$/);
    expect(t.mail.sent[0]!.html).not.toMatch(/href=/); // no link, on purpose

    const r2 = await post(t.app, t.env, SALES, "/auth/verify", { email: "peter.nahas@mezzarestaurant.com", code: lastCode(t.mail) });
    expect(r2.status).toBe(200);
    const sc = r2.headers.get("set-cookie")!;
    expect(sc).toMatch(/^mzsc=[A-Za-z0-9_-]{40,}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000; Secure$/);
    expect(sc).not.toMatch(/Domain=/);

    const cookie = cookieOf(r2);
    expect((await get(t.app, t.env, SALES, "/", cookie)).status).toBe(200);
    const me = await (await get(t.app, t.env, SALES, "/auth/me", cookie)).json() as any;
    expect(me.user.email).toBe("peter.nahas@mezzarestaurant.com");
    expect(me.app.id).toBe("sales");
    expect((await (await get(t.app, t.env, SALES, "/api/secret", cookie)).json() as any).who).toBe("peter.nahas@mezzarestaurant.com");
  });

  it("no cookie → 401 on pages and APIs; security headers present", async () => {
    const r = await get(t.app, t.env, SALES, "/");
    expect(r.status).toBe(401);
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect((await get(t.app, t.env, SALES, "/api/secret")).status).toBe(401);
  });

  it("unknown and deactivated emails get the same answer and no email", async () => {
    const a = await post(t.app, t.env, SALES, "/auth/request-code", { email: "nobody@mezzarestaurant.com" });
    const b = await post(t.app, t.env, SALES, "/auth/request-code", { email: "former@mezzarestaurant.com" });
    const c = await post(t.app, t.env, SALES, "/auth/request-code", { email: "not-an-email" });
    const [ta, tb, tc] = await Promise.all([a.text(), b.text(), c.text()]);
    expect(ta).toBe(tb); expect(tb).toBe(tc);
    expect(t.mail.sent).toHaveLength(0);
    const ev = t.db.raw.prepare("SELECT type, detail FROM auth_events ORDER BY created_at").all() as any[];
    expect(ev.map((e) => e.detail)).toEqual(["unknown", "inactive"]);
  });

  it("wrong, reused and expired codes fail with the same message", async () => {
    await post(t.app, t.env, SALES, "/auth/request-code", { email: "peter.nahas@mezzarestaurant.com" });
    const code = lastCode(t.mail);
    const wrong = code === "123456" ? "654321" : "123456";
    const r1 = await post(t.app, t.env, SALES, "/auth/verify", { email: "peter.nahas@mezzarestaurant.com", code: wrong });
    expect(r1.status).toBe(401);
    const r1Text = await r1.text();
    const ok = await post(t.app, t.env, SALES, "/auth/verify", { email: "peter.nahas@mezzarestaurant.com", code });
    expect(ok.status).toBe(200);
    const reuse = await post(t.app, t.env, SALES, "/auth/verify", { email: "peter.nahas@mezzarestaurant.com", code });
    expect(reuse.status).toBe(401);
    expect(await reuse.text()).toBe(r1Text);
    expect((await post(t.app, t.env, SALES, "/auth/verify", { email: "peter.nahas@mezzarestaurant.com", code: "12" })).status).toBe(400);
  });

  it("two codes requested: either works, and it is the same email either way", async () => {
    await post(t.app, t.env, SALES, "/auth/request-code", { email: "peter.nahas@mezzarestaurant.com" });
    const first = lastCode(t.mail);
    await post(t.app, t.env, SALES, "/auth/request-code", { email: "peter.nahas@mezzarestaurant.com" });
    expect(t.mail.sent).toHaveLength(2);
    expect((await post(t.app, t.env, SALES, "/auth/verify", { email: "peter.nahas@mezzarestaurant.com", code: first })).status).toBe(200);
  });

  it("rate limits: 3 codes per email per window, then silence; verify attempts per IP → 429", async () => {
    for (let i = 0; i < 5; i++) await post(t.app, t.env, SALES, "/auth/request-code", { email: "peter.nahas@mezzarestaurant.com" });
    expect(t.mail.sent).toHaveLength(3);
    let last: Response | null = null;
    for (let i = 0; i < 12; i++) last = await post(t.app, t.env, SALES, "/auth/verify", { email: "peter.nahas@mezzarestaurant.com", code: "000000" }, {}, "9.9.9.9");
    expect(last!.status).toBe(429);
  });

  it("email limit is per application, with a ceiling across all of them", async () => {
    for (let i = 0; i < 3; i++) await post(t.app, t.env, SALES, "/auth/request-code", { email: "peter.nahas@mezzarestaurant.com" });
    await post(t.app, t.env, TRIPOLI, "/auth/request-code", { email: "peter.nahas@mezzarestaurant.com" });
    expect(t.mail.sent).toHaveLength(4); // the 4th, on another app, still goes out
    for (let i = 0; i < 20; i++) await post(t.app, t.env, HUB, "/auth/request-code", { email: "peter.nahas@mezzarestaurant.com" });
    expect(t.mail.sent.length).toBeLessThanOrEqual(12);
  });

  it("CSRF: missing marker or foreign Origin is refused", async () => {
    const noMarker = await t.app.request(`https://${SALES}/auth/request-code`, { method: "POST", headers: { "content-type": "application/json", origin: `https://${SALES}` }, body: "{}" }, t.env);
    expect(noMarker.status).toBe(403);
    const foreign = await post(t.app, t.env, SALES, "/auth/request-code", { email: "x@y.z" }, { origin: "https://evil.example" });
    expect(foreign.status).toBe(403);
    const otherMezza = await post(t.app, t.env, SALES, "/auth/request-code", { email: "x@y.z" }, { origin: `https://${TRIPOLI}` });
    expect(otherMezza.status).toBe(403);
  });

  it("a session cookie from sales does not work on tripoli (no cross-application session)", async () => {
    await post(t.app, t.env, SALES, "/auth/request-code", { email: "peter.nahas@mezzarestaurant.com" });
    const r = await post(t.app, t.env, SALES, "/auth/verify", { email: "peter.nahas@mezzarestaurant.com", code: lastCode(t.mail) });
    const cookie = cookieOf(r);
    expect((await get(t.app, t.env, TRIPOLI, "/", cookie)).status).toBe(401);
  });

  it("logout clears the cookie and kills the session", async () => {
    await post(t.app, t.env, SALES, "/auth/request-code", { email: "peter.nahas@mezzarestaurant.com" });
    const cookie = cookieOf(await post(t.app, t.env, SALES, "/auth/verify", { email: "peter.nahas@mezzarestaurant.com", code: lastCode(t.mail) }));
    const out = await post(t.app, t.env, SALES, "/auth/logout", {}, { cookie });
    expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await get(t.app, t.env, SALES, "/", cookie)).status).toBe(401);
  });

  it("deactivating a user ends their live session", async () => {
    await post(t.app, t.env, SALES, "/auth/request-code", { email: "peter.nahas@mezzarestaurant.com" });
    const cookie = cookieOf(await post(t.app, t.env, SALES, "/auth/verify", { email: "peter.nahas@mezzarestaurant.com", code: lastCode(t.mail) }));
    t.db.raw.exec("UPDATE users SET is_active = 0 WHERE id = 'u_peter'");
    expect((await get(t.app, t.env, SALES, "/", cookie)).status).toBe(401);
  });

  it("session fixation: a token chosen by the attacker is never accepted", async () => {
    expect((await get(t.app, t.env, SALES, "/", "mzsc=" + "A".repeat(43))).status).toBe(401);
  });

  it("hand-off: hub session → one-time token → sales session, once only, right host only", async () => {
    await post(t.app, t.env, HUB, "/auth/request-code", { email: "peter.nahas@mezzarestaurant.com" });
    const hubCookie = cookieOf(await post(t.app, t.env, HUB, "/auth/verify", { email: "peter.nahas@mezzarestaurant.com", code: lastCode(t.mail) }));

    const r = await get(t.app, t.env, HUB, `/auth/sso?to=${encodeURIComponent(`https://${SALES}/?tab=labour`)}`, hubCookie);
    expect(r.status).toBe(302);
    const loc = new URL(r.headers.get("location")!);
    expect(loc.host).toBe(SALES);
    expect(loc.pathname).toBe("/auth/callback");
    const token = loc.searchParams.get("t")!;

    // wrong host tries to redeem it: refused and burned
    const wrongHost = await get(t.app, t.env, TRIPOLI, `/auth/callback?t=${token}&next=/`);
    expect(wrongHost.status).toBe(302);
    expect(wrongHost.headers.get("location")).toContain("sso=none");
    expect(wrongHost.headers.get("set-cookie")).toBeNull();

    // so the right host now can't either — single use
    const burned = await get(t.app, t.env, SALES, loc.pathname + loc.search);
    expect(burned.headers.get("set-cookie")).toBeNull();

    // do it again properly
    const r2 = await get(t.app, t.env, HUB, `/auth/sso?to=${encodeURIComponent(`https://${SALES}/?tab=labour`)}`, hubCookie);
    const loc2 = new URL(r2.headers.get("location")!);
    const cb = await get(t.app, t.env, SALES, loc2.pathname + loc2.search);
    expect(cb.status).toBe(302);
    expect(cb.headers.get("location")).toBe(`https://${SALES}/?tab=labour`);
    const salesCookie = cookieOf(cb);
    expect((await get(t.app, t.env, SALES, "/", salesCookie)).status).toBe(200);
    // the hub cookie itself is still useless on sales
    expect((await get(t.app, t.env, SALES, "/", hubCookie)).status).toBe(401);
  });

  it("hand-off refuses destinations that are not ours and open redirects", async () => {
    await post(t.app, t.env, HUB, "/auth/request-code", { email: "peter.nahas@mezzarestaurant.com" });
    const hubCookie = cookieOf(await post(t.app, t.env, HUB, "/auth/verify", { email: "peter.nahas@mezzarestaurant.com", code: lastCode(t.mail) }));
    expect((await get(t.app, t.env, HUB, `/auth/sso?to=${encodeURIComponent("https://evil.example/")}`, hubCookie)).status).toBe(400);
    expect((await get(t.app, t.env, HUB, `/auth/sso?to=${encodeURIComponent("http://" + SALES + "/")}`, hubCookie)).status).toBe(400);
    // no hub session → bounce back with sso=none, no token
    const r = await get(t.app, t.env, HUB, `/auth/sso?to=${encodeURIComponent(`https://${SALES}/x`)}`);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(`https://${SALES}/x?sso=none`);
    // callback ignores a protocol-relative next
    await post(t.app, t.env, HUB, "/auth/request-code", { email: "peter.nahas@mezzarestaurant.com" });
    const r2 = await get(t.app, t.env, HUB, `/auth/sso?to=${encodeURIComponent(`https://${SALES}/`)}`, hubCookie);
    const loc = new URL(r2.headers.get("location")!);
    const cb = await get(t.app, t.env, SALES, `/auth/callback?t=${loc.searchParams.get("t")}&next=${encodeURIComponent("//evil.example/")}`);
    expect(cb.headers.get("location")).toBe(`https://${SALES}/`);
  });

  it("sso endpoints are 404 on a non-hub host", async () => {
    expect((await get(t.app, t.env, SALES, `/auth/sso?to=${encodeURIComponent(`https://${TRIPOLI}/`)}`)).status).toBe(404);
  });

  it("sweep clears expired codes and sessions", async () => {
    await post(t.app, t.env, SALES, "/auth/request-code", { email: "peter.nahas@mezzarestaurant.com" });
    t.db.age("login_codes", "created_at", 2 * 1440);
    await t.auth.sweep(t.db);
    expect((t.db.raw.prepare("SELECT count(*) n FROM login_codes").get() as any).n).toBe(0);
  });
});
