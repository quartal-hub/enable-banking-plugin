import { Helpers, type QuartalPluginContext } from "@quartal/plugin";
import { fetchAccountStatement, fetchBalances, fetchTransactionPage } from "../enable-banking/AccountData.ts";
import {
  claimCompletedConnections,
  createAuthorizationState,
  findAuthorizationResult,
  linkAuthorizationId,
} from "../enable-banking/AuthorizationStore.ts";
import {
  findConnection,
  listStoredConnections,
  removeConnection,
  requireAccountConnection,
  requireUser,
  toConnection,
  type UserContext,
  withConnection,
} from "../enable-banking/Connections.ts";
import { enableBankingRequest } from "../enable-banking/EnableBankingClient.ts";
import { logToolCall } from "../enable-banking/logToolCall.ts";
import { createPrintToken } from "../enable-banking/PrintLinks.ts";
import type {
  Account,
  AccountStatement,
  AuthorizationResult,
  AuthorizationStart,
  Balance,
  Bank,
  Connection,
  StatementPrintLink,
  TransactionPage,
} from "./model/BankingModel.ts";

/** Where Enable Banking sends the user's browser back to. Must match a registered redirect URL. */
const CALLBACK_PATH = "/enable-banking/callback";

/** Path of the printable statement page (`src/pages/enable-banking/statement.astro`) */
const PRINT_PATH = "/enable-banking/statement";

/** Days of account access requested from the bank */
const ACCESS_DAYS = 90;

/**
 * Bank account information through Enable Banking: list banks, connect a bank account, and read
 * accounts and balances. Every tool works on the logged-in user's own bank connections, which are
 * kept on the server.
 */
export class EnableBanking {
  /**
   * Lists the banks available in a country
   * @param input The country
   * @param ctx The logged-in user
   * @returns The banks
   * @readOnly
   */
  static async listBanks(input: {
    /**
     * Two-letter country code
     * @example "FI"
     */
    country: string;
  }, ctx?: QuartalPluginContext): Promise<Bank[]> {
    logToolCall("listBanks", ctx);
    const res = await enableBankingRequest<{
      aspsps: { name: string; country: string; logo?: string; psu_types?: string[] }[];
    }>("GET", `/aspsps?country=${encodeURIComponent(input.country.toUpperCase())}`);
    return res.aspsps.map((a) => ({ name: a.name, country: a.country, logo: a.logo, psuTypes: a.psu_types }));
  }

  /**
   * Starts connecting a bank account. Returns a URL the user opens to log in to their bank and
   * approve access. When they are done, `getAuthorizationResult` with the returned
   * `authorizationId` tells whether it worked; the bank's accounts are then in `listAccounts`.
   * @param input The bank to connect
   * @param ctx The logged-in user
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
  }, ctx?: QuartalPluginContext): Promise<AuthorizationStart> {
    logToolCall("startAuthorization", ctx);
    const { uid } = requireUser(ctx);
    const country = input.country.toUpperCase();
    const psuType = input.psuType ?? "personal";
    const validUntil = new Date(Date.now() + ACCESS_DAYS * 24 * 3600 * 1000).toISOString();
    const state = await createAuthorizationState({ uid, bank: input.bank, country, psuType, validUntil });
    const res = await enableBankingRequest<{ url: string; authorization_id: string }>("POST", "/auth", {
      access: { valid_until: validUntil },
      aspsp: { name: input.bank, country },
      state,
      redirect_url: redirectUrl(),
      psu_type: psuType,
    });
    await linkAuthorizationId(state, res.authorization_id);
    return { url: res.url, authorizationId: res.authorization_id };
  }

  /**
   * Checks whether the user has finished connecting their bank. Call it after the user says
   * they are done at the bank; once `status` is `connected`, the result has the accounts.
   * @param input The authorization
   * @param ctx The logged-in user
   * @returns The authorization's status, and the accounts once connected
   * @readOnly
   */
  static async getAuthorizationResult(input: {
    /** The `authorizationId` returned by `startAuthorization` */
    authorizationId: string;
  }, ctx?: QuartalPluginContext): Promise<AuthorizationResult> {
    logToolCall("getAuthorizationResult", ctx);
    const user = await signedIn(ctx);
    return findAuthorizationResult(user.uid, input.authorizationId);
  }

  /**
   * Lists the banks the user has connected, and whether each still gives access
   * @param _input No input
   * @param ctx The logged-in user
   * @returns The connections, oldest first
   * @readOnly
   */
  static async listConnections(_input?: Record<string, never>, ctx?: QuartalPluginContext): Promise<Connection[]> {
    logToolCall("listConnections", ctx);
    return (await listStoredConnections(await signedIn(ctx))).map(toConnection);
  }

  /**
   * Lists the accounts of the user's connected banks
   * @param input Optional connection
   * @param ctx The logged-in user
   * @returns The accounts of the active connections
   * @readOnly
   */
  static async listAccounts(input: {
    /** Only the accounts of this connection from `listConnections` */
    connectionId?: string;
  }, ctx?: QuartalPluginContext): Promise<Account[]> {
    logToolCall("listAccounts", ctx);
    const connections = await listStoredConnections(await signedIn(ctx));
    return connections
      .filter((c) => c.status === "active" && (!input.connectionId || c.connectionId === input.connectionId))
      .flatMap((c) => c.accounts.map((a) => ({ ...a, bank: c.bank })));
  }

  /**
   * Gets the balances of an account
   * @param input The account
   * @param ctx The logged-in user
   * @returns The balances the bank reports
   * @readOnly
   */
  static async getBalances(input: {
    /** Account `uid` from `listAccounts` */
    accountId: string;
  }, ctx?: QuartalPluginContext): Promise<Balance[]> {
    logToolCall("getBalances", ctx);
    const user = await signedIn(ctx);
    const connection = await requireAccountConnection(user, input.accountId);
    return withConnection(user, connection, () => fetchBalances(input.accountId));
  }

  /**
   * Lists the transactions of an account, one page at a time. When the result has a
   * `continuationKey`, call again with it to get the next page.
   * @param input The account and optional date range
   * @param ctx The logged-in user
   * @returns One page of transactions
   * @readOnly
   */
  static async listTransactions(input: {
    /** Account `uid` from `listAccounts` */
    accountId: string;
    /**
     * First booking date to include. Not every bank supports date filtering.
     * @format date
     */
    dateFrom?: string;
    /**
     * Last booking date to include
     * @format date
     */
    dateTo?: string;
    /** `continuationKey` from the previous page */
    continuationKey?: string;
  }, ctx?: QuartalPluginContext): Promise<TransactionPage> {
    logToolCall("listTransactions", ctx);
    const user = await signedIn(ctx);
    const connection = await requireAccountConnection(user, input.accountId);
    return withConnection(user, connection, () => fetchTransactionPage(input.accountId, input));
  }

  /**
   * Builds an account statement (tiliote) for a period: opening and closing balance, every booked
   * transaction with the running balance, and totals of money in and out. Shown as a printable
   * statement by its widget. Use it when the user asks for a statement or an overview of a period;
   * use `listTransactions` for searching individual transactions.
   * @param input The account and period
   * @param ctx The logged-in user
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
  }, ctx?: QuartalPluginContext): Promise<AccountStatement> {
    logToolCall("getAccountStatement", ctx);
    const user = await signedIn(ctx);
    const connection = await requireAccountConnection(user, input.accountId);
    return withConnection(user, connection, () =>
      fetchAccountStatement(input.accountId, input.dateFrom, input.dateTo),
    );
  }

  /**
   * Creates a short-lived link to a printable page of an account statement, for the Account
   * statement widget's print button (widgets cannot open the print dialog themselves)
   * @param input The account and period, as in `getAccountStatement`
   * @param ctx The logged-in user
   * @returns The link, valid for 10 minutes
   * @visibility app
   * @destructive false
   */
  static async createStatementPrintLink(input: {
    /** Account `uid` from `listAccounts` */
    accountId: string;
    /**
     * First day of the period
     * @format date
     */
    dateFrom: string;
    /**
     * Last day of the period
     * @format date
     */
    dateTo: string;
  }, ctx?: QuartalPluginContext): Promise<StatementPrintLink> {
    logToolCall("createStatementPrintLink", ctx);
    const user = await signedIn(ctx);
    const { uid } = user;
    const { bank } = await requireAccountConnection(user, input.accountId);
    const { accountId, dateFrom, dateTo } = input;
    const url = new URL(PRINT_PATH, redirectUrl());
    url.searchParams.set("token", await createPrintToken({ uid, accountId, dateFrom, dateTo, bank }));
    return { url: url.href };
  }

  /**
   * Disconnects a bank: ends the plugin's access to it at Enable Banking and forgets the
   * connection. Only when the user asks for it.
   * @param input The connection
   * @param ctx The logged-in user
   * @returns The disconnected connection
   * @destructive
   */
  static async disconnectBank(input: {
    /** `connectionId` from `listConnections` */
    connectionId: string;
  }, ctx?: QuartalPluginContext): Promise<Connection> {
    logToolCall("disconnectBank", ctx);
    const user = await signedIn(ctx);
    const connection = await findConnection(user, input.connectionId);
    if (!connection) throw new Error("Unknown connection id. Use a connectionId from listConnections.");
    await removeConnection(user, connection);
    return toConnection(connection);
  }
}

/**
 * The logged-in user, after saving the connections they completed at the bank since their last
 * tool call
 * @param ctx The tool call's context
 */
async function signedIn(ctx: QuartalPluginContext | undefined): Promise<UserContext> {
  const user = requireUser(ctx);
  await claimCompletedConnections(user);
  return user;
}

/** The callback URL: `ENABLE_BANKING_REDIRECT_URL`, or the local dev server by default */
function redirectUrl(): string {
  return Helpers.getEnvVar("ENABLE_BANKING_REDIRECT_URL") ?? `http://localhost:4321${CALLBACK_PATH}`;
}
