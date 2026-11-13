// Reads account data from Enable Banking. No access checks here: callers first resolve the account
// to one of the logged-in user's connections (`requireAccountConnection` in Connections.ts).
import type { AccountStatement, Balance, Transaction, TransactionPage } from "../tools/model/BankingModel.ts";
import { buildAccountStatement } from "./buildAccountStatement.ts";
import { enableBankingRequest } from "./EnableBankingClient.ts";
import { type RawAccount, toAccount } from "./toAccount.ts";
import { type RawBalance, toBalance } from "./toBalance.ts";
import { type RawTransaction, toTransaction } from "./toTransaction.ts";

/** Upper limit of transaction pages fetched for one statement */
const MAX_STATEMENT_PAGES = 50;

/**
 * The balances of an account
 * @param accountId Account `uid`
 */
export async function fetchBalances(accountId: string): Promise<Balance[]> {
  const res = await enableBankingRequest<{ balances: RawBalance[] }>(
    "GET",
    `/accounts/${encodeURIComponent(accountId)}/balances`,
  );
  return res.balances.map(toBalance);
}

/**
 * One page of an account's transactions
 * @param accountId Account `uid`
 * @param options Optional date range and the `continuationKey` of the previous page
 */
export async function fetchTransactionPage(
  accountId: string,
  options: { dateFrom?: string; dateTo?: string; continuationKey?: string },
): Promise<TransactionPage> {
  const query = new URLSearchParams();
  if (options.dateFrom) query.set("date_from", options.dateFrom);
  if (options.dateTo) query.set("date_to", options.dateTo);
  if (options.continuationKey) query.set("continuation_key", options.continuationKey);
  const qs = query.size ? `?${query}` : "";
  const res = await enableBankingRequest<{ transactions: RawTransaction[]; continuation_key?: string | null }>(
    "GET",
    `/accounts/${encodeURIComponent(accountId)}/transactions${qs}`,
  );
  return {
    transactions: res.transactions.map(toTransaction),
    continuationKey: res.continuation_key ?? undefined,
  };
}

/**
 * The account statement of a period: see {@link buildAccountStatement}
 * @param accountId Account `uid`
 * @param dateFrom First day, default the first day of the previous calendar month
 * @param dateTo Last day, default the last day of the previous calendar month
 */
export async function fetchAccountStatement(
  accountId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<AccountStatement> {
  const period = statementPeriod(dateFrom, dateTo);
  const [details, balances, transactions] = await Promise.all([
    enableBankingRequest<RawAccount>("GET", `/accounts/${encodeURIComponent(accountId)}/details`),
    fetchBalances(accountId),
    // From the period start until today: later transactions are needed to work back from the
    // current balance to the balances of the period.
    fetchAllTransactions(accountId, period.dateFrom),
  ]);
  return buildAccountStatement({
    account: toAccount(details),
    balances,
    transactions: transactions.transactions,
    complete: transactions.complete,
    dateFrom: period.dateFrom,
    dateTo: period.dateTo,
    today: isoDate(new Date()),
  });
}

/**
 * All transactions booked from `dateFrom` on, following the `continuationKey` pages
 * @param accountId Account `uid`
 * @param dateFrom First booking date
 */
async function fetchAllTransactions(
  accountId: string,
  dateFrom: string,
): Promise<{ transactions: Transaction[]; complete: boolean }> {
  const transactions: Transaction[] = [];
  let continuationKey: string | undefined;
  for (let page = 0; page < MAX_STATEMENT_PAGES; page++) {
    const res = await fetchTransactionPage(accountId, { dateFrom, continuationKey });
    transactions.push(...res.transactions);
    continuationKey = res.continuationKey;
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
