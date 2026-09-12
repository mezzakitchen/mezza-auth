/** Ids, time, hashing — the same helpers Ops uses, in one place. */
export function base64url(bytes) {
    let s = "";
    for (const b of bytes)
        s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function randomToken(bytes = 32) {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return base64url(buf);
}
export function newId(prefix) {
    return `${prefix}_${randomToken(12)}`;
}
export async function sha256Hex(input) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** Constant-time compare for equal-length ASCII strings (hex digests). */
export function safeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    let r = 0;
    for (let i = 0; i < a.length; i++)
        r |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return r === 0;
}
export const nowIso = () => new Date().toISOString();
export const plusMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();
export const plusDays = (d) => new Date(Date.now() + d * 86_400_000).toISOString();
/** Uniform, unbiased n-digit numeric code from the CSPRNG. */
export function randomDigits(n) {
    const max = 10 ** n;
    // Rejection sampling avoids the modulo bias `% max` would introduce.
    const limit = Math.floor(0x1_0000_0000 / max) * max;
    const buf = new Uint32Array(1);
    let v;
    do {
        crypto.getRandomValues(buf);
        v = buf[0];
    } while (v >= limit);
    return String(v % max).padStart(n, "0");
}
export function normaliseEmail(raw) {
    if (typeof raw !== "string")
        return null;
    const e = raw.trim().toLowerCase();
    if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
        return null;
    return e;
}
export function clientIp(req) {
    return req.headers.get("CF-Connecting-IP") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}
export function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
