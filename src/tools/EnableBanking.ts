import { Helpers } from "@quartal/plugin";
import { enableBankingRequest } from "../enable-banking/EnableBankingClient.ts";
import { sessionEndedError } from "../enable-banking/EnableBankingError.ts";
import {
  createAuthorizationState,
  findAuthorizationResult,
  linkAuthorizationId,
} from "../enable-banking/AuthorizationStore.ts";
import { buildAccountStatement } from "../enable-banking/buildAccountStatement.ts";
import { type RawAccount, toAccount } from "../enable-banking/toAccount.ts";
import { type RawBalance, toBalance } from "../enable-banking/toBalance.ts";
import { type RawTransaction, toTransaction } from "../enable-banking/toTransaction.ts";
import type {
  Account,
  AccountStatement,
  AuthorizationResult,
  AuthorizationStart,
  Bank,
} from "./model/BankingModel.ts";

/** Where Enable Banking sends the user's browser back to. Must match a registered redirect URL. */
const CALLBACK_PATH = "/enable-banking/callback";

/** Days of account access requested from the bank */
const ACCESS_DAYS = 90;

/**
 * Bank account information through Enable Banking: list banks, connect a bank account, and read
 * accounts and balances
 */
export class EnableBanking {
  /**
   * Lists the banks available in a country
   * @param input The country
   * @returns The banks
   * @readOnly
   */
  static async listBanks(input: {
    /**
     * Two-letter country code
     * @example "FI"
     */
    country: string;
  }): Promise<Bank[]> {
    const res = await enableBankingRequest<{
      aspsps: { name: string; country: string; logo?: string; psu_types?: string[] }[];
    }>("GET", `/aspsps?country=${encodeURIComponent(input.country.toUpperCase())}`);
    return res.aspsps.map((a) => ({ name: a.name, country: a.country, logo: a.logo, psuTypes: a.psu_types }));
  }

  /**
   * Starts connecting a bank account. Returns a URL the user opens to log in to their bank and
   * approve access. When they are done, `getAuthorizationResult` with the returned
   * `authorizationId` gives the session id for `listAccounts`.
   * @param input The bank to connect
   * @returns The bank login URL
   * @destructive false
   */
  static async startAuthorization(input: {
    /** Bank name, exactly as returned by `listBanks` */
    bank: string;
    /**
     * Two-letter country code of the bank
     * @example "FI"
     */
    country: string;
    /** Customer type. Default `personal`. */
    psuType?: "personal" | "business";
  }): Promise<AuthorizationStart> {
    const state = createAuthorizationState(input.bank);
    const validUntil = new Date(Date.now() + ACCESS_DAYS * 24 * 3600 * 1000).toISOString();
    const res = await enableBankingRequest<{ url: string; authorization_id: string }>("POST", "/auth", {
      access: { valid_until: validUntil },
      aspsp: { name: input.bank, country: input.country.toUpperCase() },
      state,
      redirect_url: redirectUrl(),
      psu_type: input.psuType ?? "personal",
    });
    linkAuthorizationId(state, res.authorization_id);
    return { url: res.url, authorizationId: res.authorization_id };
  }

  /**
   * Checks whether the user has finished connecting their bank. Call it after the user says
   * they are done at the bank; once `status` is `connected`, the result has the session id and
   * accounts.
   * @param input The authorization
   * @returns The authorization's status, and the session once connected
   * @readOnly
   */
  static getAuthorizationResult(input: {
    /** The `authorizationId` returned by `startAuthorization` */
    authorizationId: string;
  }): AuthorizationResult {
    return findAuthorizationResult(input.authorizationId);
  }

  /**
   * Lists the accounts of a connected bank session
   * @param input The session
   * @returns The accounts
   * @readOnly
   */
  static async listAccounts(input: {
    /** Session id shown after connecting a bank */
    sessionId: string;
  }): Promise<Account[]> {
    // The session lists account ids only; name, IBAN and currency come from each account's details.
    const session = await enableBankingRequest<{ status?: string; accounts?: string[] }>(
      "GET",
      `/sessions/${encodeURIComponent(input.sessionId)}`,
    );
    // A closed or expired session still answers here; only its account calls fail.
    if (session.status && session.status !== "AUTHORIZED") throw sessionEndedError(session.status);
    const details = await Promise.all(
      (session.accounts ?? []).map((uid) =>
        enableBankingRequest<RawAccount>("GET", `/accounts/${encodeURIComponent(uid)}/details`),
      ),
    );
    return details.map(toAccount);
  }

  /**
   * Builds an account statement (tiliote) for a period: opening and closing balance, every booked
   * transaction with the running balance, and totals of money in and out. Shown as a
   * statement by its widget. Use it when the user asks for a statement or an overview of a period.
   * @param input The account and period
   * @returns The statement
   * @readOnly
   */
  static async getAccountStatement(input: {
    /** Account `uid` from `listAccounts` */
    accountId: string;
    /**
     * First day of the period. Default: the first day of the previous calendar month.
     * @format date
     */
    dateFrom?: string;
    /**
     * Last day of the period. Default: the last day of the previous calendar month.
     * @format date
     */
    dateTo?: string;
  }): Promise<AccountStatement> {
    const period = statementPeriod(input.dateFrom, input.dateTo);
    const id = encodeURIComponent(input.accountId);
    const [details, balances, transactions] = await Promise.all([
      enableBankingRequest<RawAccount>("GET", `/accounts/${id}/details`),
      enableBankingRequest<{ balances: RawBalance[] }>("GET", `/accounts/${id}/balances`),
      // From the period start until today: later transactions are needed to work back from the
      // current balance to the balances of the period.
      fetchAllTransactions(id, period.dateFrom),
    ]);
    return buildAccountStatement({
      account: toAccount(details),
      balances: balances.balances.map(toBalance),
      transactions: transactions.transactions.map(toTransaction),
      complete: transactions.complete,
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      today: isoDate(new Date()),
    });
  }
}

/** Upper limit of transaction pages fetched for one statement */
const MAX_STATEMENT_PAGES = 50;

/**
 * All transactions booked from `dateFrom` on, following `continuation_key` pages
 * @param accountId URL-encoded account id
 * @param dateFrom First booking date
 */
async function fetchAllTransactions(
  accountId: string,
  dateFrom: string,
): Promise<{ transactions: RawTransaction[]; complete: boolean }> {
  const transactions: RawTransaction[] = [];
  let continuationKey: string | undefined;
  for (let page = 0; page < MAX_STATEMENT_PAGES; page++) {
    const query = new URLSearchParams({ date_from: dateFrom });
    if (continuationKey) query.set("continuation_key", continuationKey);
    const res = await enableBankingRequest<{ transactions: RawTransaction[]; continuation_key?: string | null }>(
      "GET",
      `/accounts/${accountId}/transactions?${query}`,
    );
    transactions.push(...res.transactions);
    continuationKey = res.continuation_key ?? undefined;
    if (!continuationKey) return { transactions, complete: true };
  }
  return { transactions, complete: false };
}

/** A date as `YYYY-MM-DD` (UTC) */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The statement period: the given dates, defaulting to the previous calendar month
 * @param dateFrom Given first day
 * @param dateTo Given last day
 */
function statementPeriod(dateFrom?: string, dateTo?: string): { dateFrom: string; dateTo: string } {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const from = dateFrom ?? isoDate(new Date(Date.UTC(year, month - 1, 1)));
  // Day 0 of a month is the last day of the month before.
  const to = dateTo ?? isoDate(new Date(Date.UTC(year, month, 0)));
  if (from > to) throw new Error(`The period start (${from}) is after its end (${to}).`);
  return { dateFrom: from, dateTo: to };
}

/** The callback URL: `ENABLE_BANKING_REDIRECT_URL`, or the local dev server by default */
function redirectUrl(): string {
  return Helpers.getEnvVar("ENABLE_BANKING_REDIRECT_URL") ?? `http://localhost:4321${CALLBACK_PATH}`;
}
