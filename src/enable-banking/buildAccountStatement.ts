import type {
  Account,
  AccountStatement,
  Balance,
  StatementLine,
  Transaction,
} from "../tools/model/BankingModel.ts";

/**
 * Balance types to calculate the statement from, most suitable first. Booked balances match booked
 * transactions; available balances may include a credit limit, and expected (`XPCD`) includes
 * pending transactions, so they are fallbacks only.
 */
const BALANCE_PREFERENCE = ["CLBD", "ITBD", "CLAV", "ITAV", "XPCD"];

/** Input of {@link buildAccountStatement} */
export interface StatementInput {
  account: Account;
  /** The account's current balances */
  balances: Balance[];
  /** Transactions booked from `dateFrom` until today (any order; later ones are needed too) */
  transactions: Transaction[];
  /** False when not every transaction page could be fetched */
  complete: boolean;
  /** First day of the period */
  dateFrom: string;
  /** Last day of the period */
  dateTo: string;
  /** Today's date, for balances without a reference date */
  today: string;
}

/**
 * Builds an account statement for a period from the account's current balance and transactions.
 *
 * Banks report only the current balance, so the period's balances are worked out backwards: the
 * closing balance is the current balance minus the transactions booked after the period, and the
 * opening balance is the closing balance minus the period's transactions. Pending transactions are
 * listed separately and left out of the balances. All arithmetic is in minor units (cents).
 * @param input Account, balances, transactions and period
 */
export function buildAccountStatement(input: StatementInput): AccountStatement {
  const source = pickBalance(input.balances);
  if (!source) {
    throw new Error("The bank reports no balance for this account, so a statement cannot be calculated.");
  }
  const currency = source.currency;
  const referenceDate = source.referenceDate ?? input.today;
  const periodEnd = input.dateTo < referenceDate ? input.dateTo : referenceDate;
  const notes = [
    `Opening and closing balances are calculated from the bank's ${source.name ?? source.type} ` +
      `(${source.type}) of ${source.amount} ${currency} on ${referenceDate}.`,
  ];
  if (periodEnd < input.dateTo) notes.push(`The period ends on ${periodEnd}, the date of the bank's balance.`);
  if (!input.complete) {
    notes.push("Not all transactions could be fetched; the balances may be incomplete.");
  }

  const booked: (Transaction & { date: string })[] = [];
  const pending: Transaction[] = [];
  for (const t of input.transactions) {
    if (t.status === "PDNG") {
      pending.push(t);
      continue;
    }
    const date = t.bookingDate ?? t.valueDate;
    if (date) booked.push({ ...t, date });
  }
  const otherCurrency = booked.filter((t) => t.currency !== currency).length;
  if (otherCurrency) notes.push(`${otherCurrency} transaction(s) in another currency were left out.`);
  const inCurrency = booked.filter((t) => t.currency === currency);

  // Booked after the period but included in the bank's balance: undo them.
  const afterPeriod = inCurrency.filter((t) => t.date > periodEnd && t.date <= referenceDate);
  const closing = cents(source.amount) - sum(afterPeriod);

  const inPeriod = inCurrency
    .filter((t) => t.date >= input.dateFrom && t.date <= periodEnd)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.reference ?? "").localeCompare(b.reference ?? ""));
  const opening = closing - sum(inPeriod);

  let running = opening;
  let totalIn = 0;
  let totalOut = 0;
  const lines: StatementLine[] = inPeriod.map((t) => {
    const amount = cents(t.amount);
    running += amount;
    if (amount >= 0) totalIn += amount;
    else totalOut -= amount;
    return {
      date: t.date,
      counterparty: t.counterparty,
      description: t.description,
      amount: decimal(amount),
      balance: decimal(running),
      reference: t.reference,
    };
  });

  return {
    account: input.account,
    currency,
    periodStart: input.dateFrom,
    periodEnd,
    openingBalance: decimal(opening),
    closingBalance: decimal(closing),
    totalIn: decimal(totalIn),
    totalOut: decimal(totalOut),
    netChange: decimal(closing - opening),
    lines,
    pending,
    notes,
    generatedAt: new Date().toISOString(),
  };
}

/** The most suitable balance to calculate from, or undefined when there is none */
function pickBalance(balances: Balance[]): Balance | undefined {
  for (const type of BALANCE_PREFERENCE) {
    const match = balances.find((b) => b.type === type);
    if (match) return match;
  }
  return balances[0];
}

/** A decimal string as integer minor units: `"-71.35"` → `-7135` */
function cents(amount: string): number {
  return Math.round(Number.parseFloat(amount) * 100);
}

/** Integer minor units as a decimal string: `-7135` → `"-71.35"` */
function decimal(minor: number): string {
  return (minor / 100).toFixed(2);
}

function sum(transactions: Transaction[]): number {
  return transactions.reduce((total, t) => total + cents(t.amount), 0);
}
