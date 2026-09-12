/** Ids, time, hashing — the same helpers Ops uses, in one place. */
export declare function base64url(bytes: Uint8Array): string;
export declare function randomToken(bytes?: number): string;
export declare function newId(prefix: string): string;
export declare function sha256Hex(input: string): Promise<string>;
/** Constant-time compare for equal-length ASCII strings (hex digests). */
export declare function safeEqual(a: string, b: string): boolean;
export declare const nowIso: () => string;
export declare const plusMinutes: (m: number) => string;
export declare const plusDays: (d: number) => string;
/** Uniform, unbiased n-digit numeric code from the CSPRNG. */
export declare function randomDigits(n: number): string;
export declare function normaliseEmail(raw: unknown): string | null;
export declare function clientIp(req: Request): string;
export declare function escapeHtml(s: string): string;
