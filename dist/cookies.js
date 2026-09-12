/** Build the Set-Cookie value. maxAgeSeconds = 0 clears it. Host-only unless a domain is set on purpose. */
export function cookieHeader(policy, token, maxAgeSeconds) {
    const parts = [`${policy.name}=${token}`, "Path=/", "HttpOnly", `SameSite=${policy.sameSite}`, `Max-Age=${maxAgeSeconds}`];
    if (policy.secure)
        parts.push("Secure");
    if (policy.domain)
        parts.push(`Domain=${policy.domain}`);
    return parts.join("; ");
}
export function readCookie(req, name) {
    const raw = req.headers.get("cookie");
    if (!raw)
        return null;
    for (const part of raw.split(";")) {
        const [k, ...v] = part.trim().split("=");
        if (k === name)
            return v.join("=");
    }
    return null;
}
