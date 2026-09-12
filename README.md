# @mezzakitchen/auth

Mezza's standard sign-in for internal applications on Cloudflare Workers. Extracted from Mezza
Operations; used by Operations and the Scorecard; intended for Mezza University.

**What it does:** work email → 6-digit code by email → session cookie. No passwords, no links in
emails, no third-party login screen, no redirects between domains.

**What it deliberately does not do:** know who your users are or what they may open. The host
application supplies `findUser` / `loadUser` (its own directory) and does its own authorisation after
`getSession`. Authentication is shared; authorisation stays with each application.

## Behaviour (the rules every Mezza app inherits)

| | |
|---|---|
| Code | 6 digits from the CSPRNG (rejection-sampled, no modulo bias), valid **10 min** |
| Storage | `SHA-256(code:email:pepper)` — the code itself is never written anywhere |
| Several codes | up to **3 live codes** per email; **any of them works**; success retires all; requesting a 4th retires the oldest |
| Wrong guesses | **8 across all live codes** → all retired; the person simply requests a new code |
| Request limits | 3 per email **per application** (12 across all), 30 per IP, per 15 min. Unknown / inactive / limited addresses get the same 200 and the same CPU |
| Verify limits | 60 per IP per 15 min → 429 |
| Session | 32 random bytes in the cookie; only its SHA-256 in D1; **30 days** absolute (180 for shared store devices), **14 days idle**; pinned to the hostname it was created on |
| Cookie | `HttpOnly; Secure; SameSite=Lax; Path=/`, **host-only** (no `Domain`), name chosen per product (`mzops`, `mzsc`) |
| Logout | deletes the row; `revokeUserSessions` for "sign out everywhere"; deactivating a user ends their sessions on next request |
| CSRF | non-GET calls need `Origin` host = request host **and** `X-Requested-With: <marker>` |
| Audit | `auth_events`: every request, refusal, send, verify, lock, logout, hand-off — with IP and UA, 90-day retention |
| Hand-off | optional: a hub host mints a **single-use, 60 s** token bound to person + destination host; the destination creates its own host-only session. No shared cookie, ever |

## Install

The repo is public and consumed as a pinned git dependency — no registry, no token:
```json
"dependencies": { "@mezzakitchen/auth": "github:mezzakitchen/mezza-auth#v1.0.0", "hono": "^4.6.0" }
```
`npm install` clones the tag and runs `prepare` (the TypeScript build). Bump the tag to upgrade.

## Wire it up

```ts
import { Hono } from "hono";
import { createAuth, ResendProvider, ConsoleProvider, parseRedirectList, renderLoginPage } from "@mezzakitchen/auth";

const auth = createAuth<Env, MyUser>({
  db: (env) => env.DB,
  pepper: (env) => env.AUTH_PEPPER,
  cookie: (env) => ({ name: "mzsc", secure: env.ENVIRONMENT !== "development", sameSite: "Lax" }),
  mail: (env) => ({
    provider: env.MAIL_PROVIDER === "console" ? new ConsoleProvider() : new ResendProvider(env.RESEND_API_KEY, env.MAIL_FROM),
    from: env.MAIL_FROM,
    redirectTo: parseRedirectList(env.MAIL_REDIRECT_TO),   // test mode
  }),
  app: (req) => appForHost(new URL(req.url).host),          // { id, name, host } | null
  findUser: (db, email) => …,                               // your users table
  loadUser: (db, id) => …,
  publicUser: (u) => ({ id: u.id, email: u.email, name: u.name }),
  csrfMarker: "mezza-scorecard",
  sso: { hubHost: "mezzascorecard.com", allowedHosts: () => [...] },   // optional
});

const app = new Hono<{ Bindings: Env }>();
app.use("*", auth.securityHeaders);
app.route("/auth", auth.routes);            // POST request-code | verify | logout · GET me · GET sso | callback
app.use("/api/*", auth.requireSession);     // 401 JSON without a session; c.get("auth") afterwards
app.get("*", async (c) => {
  const s = await auth.getSession(c);
  if (!s) return c.html(renderLoginPage({ appName: "Mezza Sales Scorecard", authBase: "/auth", csrfMarker: "mezza-scorecard" }), 401);
  if (!(await allowed(s.user, s.app))) return c.html(renderLoginPage({ …, denied: { email: s.user.email, contact: "Peter" } }), 403);
  return serve(c);
});
```

Schema: apply `migrations/0001_auth.sql` to the D1 database (all `CREATE IF NOT EXISTS`). A database
that already has the Operations tables also needs `0002_ops_upgrade.sql` (adds `sessions.host`).

Housekeeping: call `auth.sweep(db)` from `scheduled()`.

## Test

`npm test` runs 36 tests against real SQLite (`node:sqlite`) through a D1-shaped shim: valid, wrong,
expired and reused codes; the two-codes case both ways; the live-code cap; brute-force lock; per-email
and per-pepper isolation; session hashing, absolute/idle expiry, host pinning, logout, revoke-all,
sweep; cookie attributes; CSRF; cross-host cookie refusal; session fixation; uniform responses for
unknown addresses; the hand-off happy path, wrong-host burn, single use, open-redirect and
non-Mezza destinations.

## Versioning

Tag `vX.Y.Z` on main (CI must be green). Consumers pin the tag in package.json.
A change to the rules table above is a minor version and a note in this README; a change to the
schema is a new migration file, never an edit to an old one.
