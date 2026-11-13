import { open, seal } from "./SealedToken.ts";

/** What a print link shows: the statement of one of a user's accounts for one period */
export interface PrintLinkTarget {
  /** The user who created the link (`ctx.uid`) */
  uid: string;
  accountId: string;
  dateFrom: string;
  dateTo: string;
  /** Bank name, for the message when the connection has ended */
  bank: string;
}

// Short-lived tokens for the printable statement page. The page is opened in a plain browser tab,
// which carries no credentials, so the token stands in for the authenticated tool call that created
// it. The target is encrypted inside the token (see SealedToken.ts): nothing is stored, and the
// account id stays out of readable URLs. Tokens expire 10 minutes after they are created.

/** Lifetime of a print token */
const TTL_SECONDS = 10 * 60;

/** `SealedToken` purpose of print tokens */
const PURPOSE = "print";

/**
 * A new token for a target
 * @param target User, account and period
 */
export function createPrintToken(target: PrintLinkTarget): Promise<string> {
  return seal(PURPOSE, target, TTL_SECONDS);
}

/**
 * The target of a token, or `undefined` when it is invalid or expired. A token works repeatedly
 * until it expires, so reloading the page works.
 * @param token The token from the URL
 */
export function resolvePrintToken(token: string): Promise<PrintLinkTarget | undefined> {
  return open<PrintLinkTarget>(PURPOSE, token);
}
