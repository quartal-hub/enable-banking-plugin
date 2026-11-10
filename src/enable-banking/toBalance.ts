import type { Balance } from "../tools/model/BankingModel.ts";

/** A balance as Enable Banking returns it */
export interface RawBalance {
  name?: string;
  balance_type: string;
  balance_amount: { amount: string; currency: string };
  reference_date?: string;
}

/**
 * Maps an Enable Banking balance to the tool output shape
 * @param b The balance from the API
 */
export function toBalance(b: RawBalance): Balance {
  return {
    name: b.name,
    type: b.balance_type,
    amount: b.balance_amount.amount,
    currency: b.balance_amount.currency,
    referenceDate: b.reference_date,
  };
}
