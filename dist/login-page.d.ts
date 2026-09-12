export interface LoginPageOptions {
    appName: string;
    productName?: string;
    tagline?: string;
    logoUrl?: string;
    authBase: string;
    csrfMarker: string;
    /** Shown when a signed-in person has no access to this application. */
    denied?: {
        email: string;
        contact?: string;
    };
    /** Optional notice, e.g. "You have been signed out." */
    notice?: string;
}
export declare function renderLoginPage(o: LoginPageOptions): string;
