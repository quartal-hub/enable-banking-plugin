import { LRUCache } from "lru-cache";

/** What a print link shows: the statement of one account for one period */
export interface PrintLinkTarget {
  accountId: string;
  dateFrom: string;
  dateTo: string;
}

// Short-lived random tokens for the printable statement page. The page is opened in a plain browser
// tab, which carries no credentials, so the token stands in for the authenticated tool call that
// created it, and the account id stays out of the URL. Tokens expire 10 minutes after they are
// created; at most 1000 are kept. On globalThis so the tool modules and the print page share one
// cache even if the dev server loads this module more than once. In-memory only, like the
// authorization store.
const store = ((globalThis as Record<string, unknown>).__enableBankingPrintLinks ??= new LRUCache<
  string,
  PrintLinkTarget
>({ max: 1000, ttl: 10 * 60 * 1000 })) as LRUCache<string, PrintLinkTarget>;

/**
 * Stores a target and returns its new random token
 * @param target Account and period
 */
export function createPrintToken(target: PrintLinkTarget): string {
  const token = crypto.randomUUID();
  store.set(token, { ...target });
  return token;
}

/**
 * The target of a token, or `undefined` when it is unknown or expired. A token works repeatedly
 * until it expires, so reloading the page works.
 * @param token The token from the URL
 */
export function resolvePrintToken(token: string): PrintLinkTarget | undefined {
  return store.get(token);
}
