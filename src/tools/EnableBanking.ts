import { enableBankingRequest } from "../enable-banking/EnableBankingClient.ts";
import type { Bank } from "./model/BankingModel.ts";

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
}
