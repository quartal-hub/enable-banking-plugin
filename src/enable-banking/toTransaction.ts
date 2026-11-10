import type { Transaction } from "../tools/model/BankingModel.ts";

/** A transaction as Enable Banking returns it */
export interface RawTransaction {
  entry_reference?: string | null;
  transaction_amount: { amount: string; currency: string };
  credit_debit_indicator: "CRDT" | "DBIT";
  booking_date?: string | null;
  value_date?: string | null;
  status?: string | null;
  creditor?: { name?: string | null } | null;
  debtor?: { name?: string | null } | null;
  remittance_information?: string[] | null;
}

/**
 * Maps an Enable Banking transaction to the tool output shape: a signed amount (negative for
 * money out) and the counterparty on the other side of the payment
 * @param t The transaction from the API
 */
export function toTransaction(t: RawTransaction): Transaction {
  const credit = t.credit_debit_indicator === "CRDT";
  return {
    amount: (credit ? "" : "-") + t.transaction_amount.amount,
    currency: t.transaction_amount.currency,
    bookingDate: t.booking_date ?? undefined,
    valueDate: t.value_date ?? undefined,
    counterparty: (credit ? t.debtor?.name : t.creditor?.name) ?? undefined,
    description: t.remittance_information?.join(" ") || undefined,
    status: t.status ?? undefined,
    reference: t.entry_reference ?? undefined,
  };
}
