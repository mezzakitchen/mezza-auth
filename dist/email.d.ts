export interface Mail {
    to: string;
    subject: string;
    html: string;
    text: string;
}
export interface SendResult {
    ok: boolean;
    provider: string;
    id?: string;
    error?: string;
}
export interface MailProvider {
    name: string;
    send(mail: Mail): Promise<SendResult>;
}
export interface MailConfig {
    provider: MailProvider;
    /** e.g. "Mezza Scorecard <scorecard@mezzascorecard.com>" */
    from: string;
    /**
     * Test mode: when set, every message goes to these addresses instead of the recipient, with the real
     * recipient named in the subject. A staging deploy can never email a manager by accident.
     */
    redirectTo?: string[];
}
export declare function layout(title: string, body: string, appName: string, siteHost: string): string;
export declare function loginCodeEmail(opts: {
    code: string;
    ttlMinutes: number;
    appName: string;
    siteHost: string;
}): Omit<Mail, "to">;
export declare class ResendProvider implements MailProvider {
    private apiKey;
    private from;
    name: string;
    constructor(apiKey: string, from: string);
    send(mail: Mail): Promise<SendResult>;
}
/** Local development: log instead of sending. Codes appear in `wrangler dev` output. */
export declare class ConsoleProvider implements MailProvider {
    name: string;
    sent: Mail[];
    send(mail: Mail): Promise<SendResult>;
}
/** Apply the redirect-to test mode, then send. */
export declare function deliver(cfg: MailConfig, mail: Mail): Promise<SendResult>;
export declare function parseRedirectList(raw: string | undefined | null): string[] | undefined;
