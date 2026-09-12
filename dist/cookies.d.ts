import type { CookiePolicy } from "./types.js";
/** Build the Set-Cookie value. maxAgeSeconds = 0 clears it. Host-only unless a domain is set on purpose. */
export declare function cookieHeader(policy: CookiePolicy, token: string, maxAgeSeconds: number): string;
export declare function readCookie(req: Request, name: string): string | null;
