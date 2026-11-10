import { Helpers } from "@quartal/plugin";
import { enableBankingRequest } from "../enable-banking/EnableBankingClient.ts";
import {
  createAuthorizationState,
  findAuthorizationResult,
  linkAuthorizationId,
} from "../enable-banking/AuthorizationStore.ts";
import type { AuthorizationResult, AuthorizationStart, Bank } from "./model/BankingModel.ts";

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
}

/** The callback URL: `ENABLE_BANKING_REDIRECT_URL`, or the local dev server by default */
function redirectUrl(): string {
  return Helpers.getEnvVar("ENABLE_BANKING_REDIRECT_URL") ?? `http://localhost:4321${CALLBACK_PATH}`;
}
