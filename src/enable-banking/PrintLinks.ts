import { getPluginStore } from "./PluginStore.ts";

/** What a print link shows: the statement of one of a user's accounts for one period */
export interface PrintLinkTarget {
  /** The user who created the link (`ctx.uid`) */
  uid: string;
  accountId: string;
  dateFrom: string;
  dateTo: string;
}

// Short-lived random tokens for the printable statement page. The page is opened in a plain browser
// tab, which carries no credentials, so the token stands in for the authenticated tool call that
// created it, and the account id stays out of the URL. Tokens expire 10 minutes after they are
// created.

/** Lifetime of a print token */
const TTL_SECONDS = 10 * 60;

/**
 * Stores a target and returns its new random token
 * @param target User, account and period
 */
export async function createPrintToken(target: PrintLinkTarget): Promise<string> {
  const token = crypto.randomUUID();
  await getPluginStore().set(`print-tokens:${token}`, target, TTL_SECONDS);
  return token;
}

/**
 * The target of a token, or `undefined` when it is unknown or expired. A token works repeatedly
 * until it expires, so reloading the page works.
 * @param token The token from the URL
 */
export async function resolvePrintToken(token: string): Promise<PrintLinkTarget | undefined> {
  if (!/^[\w-]+$/.test(token)) return undefined;
  return getPluginStore().get<PrintLinkTarget>(`print-tokens:${token}`);
}
