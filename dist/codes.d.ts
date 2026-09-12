/**
 * One-time login codes.
 *
 * Storage: `login_codes` — the code is never stored, only SHA-256(code:email:pepper). Several codes can
 * be live for one email at once (see CodePolicy.maxLive); any live one is accepted; a success retires
 * them all; too many wrong guesses across the set retires them all.
 */
import type { CodePolicy, Db } from "./types.js";
export declare function hashCode(pepper: string, email: string, code: string): Promise<string>;
/**
 * Mint a code for an email that the host application has already decided is allowed to receive one.
 * Returns the plaintext code exactly once — the caller emails it and forgets it.
 */
export declare function issueCode(db: Db, pepper: string, email: string, policy: CodePolicy): Promise<{
    code: string;
    id: string;
    expiresAt: string;
}>;
/** Burn roughly the same CPU as a real issue so the response time does not reveal whether the email exists. */
export declare function burnLikeIssue(pepper: string, email: string): Promise<void>;
export type VerifyResult = {
    ok: true;
    codeId: string;
} | {
    ok: false;
    reason: "no_code" | "locked" | "mismatch";
};
export declare function verifyCode(db: Db, pepper: string, email: string, code: string, policy: CodePolicy): Promise<VerifyResult>;
export declare function sweepCodes(db: Db): Promise<void>;
