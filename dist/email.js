/**
 * The login-code email and the providers that send it. Same look as Mezza Operations: purple header,
 * one large code, no images, and — deliberately — no link. A link is what breaks in mail apps.
 */
import { escapeHtml } from "./util.js";
const PURPLE = "#54274D";
export function layout(title, body, appName, siteHost) {
    return `<!doctype html><html><body style="margin:0;background:#FAF8F4;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#2D1A2B">
<div style="max-width:560px;margin:0 auto;padding:16px">
  <div style="background:${PURPLE};color:#fff;padding:14px 18px;border-radius:10px 10px 0 0;font-weight:700;font-size:16px;letter-spacing:.2px">${escapeHtml(appName)}</div>
  <div style="background:#fff;border:1px solid #E8D8E5;border-top:0;border-radius:0 0 10px 10px;padding:18px">
    <h1 style="font-size:18px;margin:0 0 12px">${escapeHtml(title)}</h1>
    ${body}
  </div>
  <p style="color:#9B7A8F;font-size:11px;margin:12px 4px">Sent by ${escapeHtml(appName)} · ${escapeHtml(siteHost)}</p>
</div></body></html>`;
}
export function loginCodeEmail(opts) {
    const { code, ttlMinutes, appName, siteHost } = opts;
    const html = layout("Your sign-in code", `
    <p style="margin:0 0 12px">Enter this code on <strong>${escapeHtml(siteHost)}</strong> to sign in. It expires in ${ttlMinutes} minutes.</p>
    <div style="font-size:34px;font-weight:800;letter-spacing:8px;text-align:center;padding:16px;background:#F5EFF3;border-radius:8px;color:${PURPLE}">${escapeHtml(code)}</div>
    <p style="color:#6B7280;font-size:12px;margin:14px 0 0">Asked for more than one code? Any code from the last ${ttlMinutes} minutes works. If you did not request this, you can ignore this email.</p>`, appName, siteHost);
    return {
        subject: `${code} is your ${appName} sign-in code`,
        html,
        text: `Your ${appName} sign-in code is ${code}. Enter it on ${siteHost}. It expires in ${ttlMinutes} minutes.\n\nIf you did not request this, you can ignore this email.\n`,
    };
}
export class ResendProvider {
    apiKey;
    from;
    name = "resend";
    constructor(apiKey, from) {
        this.apiKey = apiKey;
        this.from = from;
    }
    async send(mail) {
        if (!this.apiKey)
            return { ok: false, provider: this.name, error: "RESEND_API_KEY not set" };
        try {
            const res = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
                body: JSON.stringify({ from: this.from, to: [mail.to], subject: mail.subject, html: mail.html, text: mail.text }),
            });
            const body = (await res.json().catch(() => ({})));
            if (!res.ok)
                return { ok: false, provider: this.name, error: `${res.status} ${body?.message ?? body?.name ?? ""}`.trim() };
            return { ok: true, provider: this.name, id: body?.id };
        }
        catch (e) {
            return { ok: false, provider: this.name, error: String(e?.message ?? e) };
        }
    }
}
/** Local development: log instead of sending. Codes appear in `wrangler dev` output. */
export class ConsoleProvider {
    name = "console";
    sent = [];
    async send(mail) {
        this.sent.push(mail);
        console.log(`[mail → ${mail.to}] ${mail.subject}\n${mail.text}`);
        return { ok: true, provider: this.name, id: `console-${Date.now()}` };
    }
}
/** Apply the redirect-to test mode, then send. */
export async function deliver(cfg, mail) {
    if (cfg.redirectTo && cfg.redirectTo.length) {
        const results = await Promise.all(cfg.redirectTo.map((to) => cfg.provider.send({ ...mail, to, subject: `[to: ${mail.to}] ${mail.subject}` })));
        const first = results.find((r) => !r.ok) ?? results[0];
        return first;
    }
    return cfg.provider.send(mail);
}
export function parseRedirectList(raw) {
    if (!raw)
        return undefined;
    const list = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    return list.length ? list : undefined;
}
