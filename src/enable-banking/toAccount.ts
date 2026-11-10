import type { Account } from "../tools/model/BankingModel.ts";

/** An account as Enable Banking returns it (`POST /sessions` accounts, `GET /accounts/{uid}/details`) */
export interface RawAccount {
  uid: string;
  account_id?: { iban?: string | null } | null;
  name?: string | null;
  currency?: string | null;
  cash_account_type?: string | null;
}

/**
 * Maps an Enable Banking account to the tool output shape
 * @param a The account from the API
 */
export function toAccount(a: RawAccount): Account {
  return {
    uid: a.uid,
    iban: a.account_id?.iban ?? undefined,
    name: a.name ?? undefined,
    currency: a.currency ?? undefined,
    type: a.cash_account_type ?? undefined,
  };
}
